import React, { useState, useEffect } from 'react';
import { 
  ConnectButton, 
  useCurrentAccount, 
  useSuiClient,
  useSignAndExecuteTransaction
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { CONFIG } from './config';

interface OracleData {
  oracle_id: string;
  expiry: number;
  strike: string;
  status: string;
  price: string | null;
}

export default function App() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [dusdcBalance, setDusdcBalance] = useState<string | null>(null);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Front-end rendering state of Oracle
  const [currentOracle, setCurrentOracle] = useState<OracleData | null>(null);

  // 3. Added React state for order parameters
  const [customStrike, setCustomStrike] = useState<string>(''); // manual strike price in USD
  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP'); // Select direction (UP/DOWN)
  const [quantity, setQuantity] = useState<string>('10'); // Bet quantity (DUSDC)
  const [minting, setMinting] = useState(false); // Betting status loading

  // 1. Query wallet DUSDC balance and PredictManager
  useEffect(() => {
    if (!account) {
      setDusdcBalance(null);
      setManagerId(null);
      return;
    }
    
    fetchUserStatus();
  }, [account, suiClient]);

  // 2-second polling: high-frequency retrieval of latest Oracle and price
  useEffect(() => {
    fetchLastestOracle(); // Initial load

    const interval = setInterval(() => {
      fetchLastestOracle();
    }, 2000); // 2000 ms = 2 seconds

    return () => clearInterval(interval);
  }, []);

  const fetchUserStatus = async () => {
    if (!account) return;
    setLoading(true);
    try {
      // Query DUSDC balance
      const coins = await suiClient.getCoins({
        owner: account.address,
        coinType: CONFIG.DUSDC_TYPE,
      });
      const totalBalance = coins.data.reduce((acc, coin) => acc + BigInt(coin.balance), 0n);
      setDusdcBalance((Number(totalBalance) / 1000000).toFixed(2)); // decimals = 6

      const managerSearchUrl = `${CONFIG.SERVER_URL}/managers?owner=${account.address}`;
      const manager = await fetch(managerSearchUrl).then(res => res.json());

      if (!manager || manager.length === 0) {
        setManagerId(null);
      } else {
        setManagerId(manager[0].manager_id);
        await fetchManagerDUSDC(manager[0].manager_id); // Query PredictManager DUSDC balance
      }
    } catch (err) {
      console.error("Failed to query user assets / manager status:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchManagerDUSDC = async (managerId: string) => {
    try {
      const managerUrl = `${CONFIG.SERVER_URL}/managers/${managerId}/summary`;
      const managerData = await fetch(managerUrl).then(res => res.json());
      if (managerData && managerData.balances && managerData.balances.length > 0) {
        setDusdcBalance((Number(managerData.balances[0].balance) / 1000000).toFixed(2));
      }
    } catch (err) {
      console.error("Failed to query PredictManager DUSDC balance:", err);
    }
  }

  // One-click PredictManager creation transaction
  const handleCreateManager = async () => {
    if (!account) return;
    setCreating(true);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${CONFIG.PREDICT_PACKAGE_ID}::predict::create_manager`,
        arguments: [],
      });

      const result = await signAndExecute({
        transaction: tx,
      });

      console.log("Create PredictManager transaction succeeded:", result);
      // Wait 2 seconds for indexing before refreshing
      setTimeout(fetchUserStatus, 2000);
    } catch (err) {
      console.error("Failed to create PredictManager:", err);
    } finally {
      setCreating(false);
    }
  };

  const fetchLastestOracle = async () => {
    try {
      const oraclesUrl = `${CONFIG.SERVER_URL}/predicts/${CONFIG.PREDICT_OBJECT_ID}/oracles`;
      const oracles  = await fetch(oraclesUrl).then(res => res.json());
      const now = Date.now();
      const activeOracles = oracles.filter((oracle: any) => oracle.status.toLowerCase() === 'active' && oracle.expiry > now);
      if (activeOracles.length === 0) {
        console.log("No active Oracle with published price currently.");
        setCurrentOracle(null);
        return null;
      }

      activeOracles.sort((a: any, b: any) => (a.expiry > b.expiry ? 1 : a.expiry < b.expiry ? -1 : 0));
      const latestOracle = activeOracles[0];
      
      const pricesUrl = `${CONFIG.SERVER_URL}/oracles/${latestOracle.oracle_id}/prices/latest`;
      const prices = await fetch(pricesUrl).then(res => res.json());
      
      const currentPrice = prices ? prices.forward : null;

      // Automatically sync the latest price to the default manual strike (if not manually entered yet)
      if (currentPrice && false) {
        setCustomStrike((Number(currentPrice) / 1000000000).toFixed(2));
      }

      setCurrentOracle({
        oracle_id: latestOracle.oracle_id,
        expiry: latestOracle.expiry,
        strike: latestOracle.strike || "0",
        status: latestOracle.status,
        price: currentPrice
      });

    } catch (err) {
      console.error("Failed to query latest Oracle:", err);
      return null;
    }
  }

  // 4. Handle order Mint function
  const handleMintPosition = async () => {
    if (!account || !managerId || !currentOracle) {
      alert("Please connect wallet, bind PredictManager, and ensure the latest Oracle is loaded!");
      return;
    }

    setMinting(true);
    try {
      // a. Calculate parameters
      // Sui oracle strike price Strike needs to be multiplied by 10^9 to scale, e.g. 65000 USD -> 65000 * 1e9
      const strikeScaled = BigInt(Math.floor(Number(customStrike) * 1000000000));
      // DUSDC Decimals is 6
      const quantityScaled = BigInt(Math.floor(Number(quantity) * 1000000));
      const isUp = direction === 'UP';

      console.log(`🚀 Initiating Mint order transaction:`);
      console.log(`   Oracle ID:  ${currentOracle.oracle_id}`);
      console.log(`   Expiry:     ${currentOracle.expiry}`);
      console.log(`   Strike:     ${strikeScaled.toString()}`);
      console.log(`   Direction:  ${direction}`);
      console.log(`   Quantity:   ${quantityScaled.toString()}`);

      const tx = new Transaction();

      // b. Construct MarketKey locally on-chain
      const marketKey = tx.moveCall({
        target: `${CONFIG.PREDICT_PACKAGE_ID}::market_key::new`,
        arguments: [
          tx.pure.id(currentOracle.oracle_id),
          tx.pure.u64(currentOracle.expiry),
          tx.pure.u64(strikeScaled),
          tx.pure.bool(isUp),
        ],
      });

      // c. Call predict::mint
      tx.moveCall({
        target: `${CONFIG.PREDICT_PACKAGE_ID}::predict::mint`,
        typeArguments: [CONFIG.DUSDC_TYPE],
        arguments: [
          tx.object(CONFIG.PREDICT_OBJECT_ID),
          tx.object(managerId),
          tx.object(currentOracle.oracle_id),
          marketKey,
          tx.pure.u64(quantityScaled),
          tx.object(CONFIG.CLOCK_ID),
        ],
      });

      // d. Sign and execute transaction
      const result = await signAndExecute({
        transaction: tx,
      });

      console.log("✅ Mint order succeeded:", result);
      alert(`Order successful! Transaction Digest: ${result.digest}`);

      // Delay 2 seconds to refresh wallet status
      setTimeout(fetchUserStatus, 2000);
    } catch (err: any) {
      console.error("❌ Mint order failed:", err);
      alert(`Order failed: ${err.message || err}`);
    } finally {
      setMinting(false);
    }
  };

  // Helper function: format expiration countdown
  const getCountdown = (expiryTimestamp: number) => {
    const diff = expiryTimestamp - Date.now();
    if (diff <= 0) return "Expired, awaiting settlement";
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #444', paddingBottom: '10px' }}>
        <h2 style={{ margin: 0 }}>🔮 Predict Keeper Debug Center</h2>
        <ConnectButton />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', alignItems: 'start' }}>
        {/* Left column: Step 1 & Step 2 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Module 1: User status and asset details */}
          {account ? (
            <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '5px' }}>
              <h3 style={{ marginTop: 0 }}>👤 Account Status (STEP 1)</h3>
              <p><strong>Wallet Address:</strong> {account.address}</p>
              <p><strong>DUSDC Balance:</strong> {loading ? 'Querying...' : `${dusdcBalance ?? '0.00'} DUSDC`}</p>
              <p>
                <strong>PredictManager Address:</strong>{' '}
                {loading ? (
                  'Querying...'
                ) : managerId ? (
                  <span style={{ color: 'green', fontWeight: 'bold' }}>{managerId}</span>
                ) : (
                  <span>
                    <span style={{ color: 'red' }}>Not Created</span>{' '}
                    <button 
                      onClick={handleCreateManager} 
                      disabled={creating}
                      style={{ marginLeft: '10px', cursor: 'pointer' }}
                    >
                      {creating ? 'Creating...' : 'Create Manager'}
                    </button>
                  </span>
                )}
              </p>
              <button onClick={fetchUserStatus} style={{ marginTop: '10px', cursor: 'pointer' }}>
                Refresh Account
              </button>
            </div>
          ) : (
            <p style={{ color: '#aaa', margin: 0 }}>Please click the top-right button to connect wallet.</p>
          )}

          {/* Module 2: Oracle price dynamic monitoring (STEP 2) */}
          <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '5px' }}>
            <h3 style={{ marginTop: 0 }}>📡 BTC Oracle Real-time Data (STEP 2)</h3>
            {currentOracle ? (
              <div>
                <p><strong>Latest Active Oracle ID:</strong> <span style={{ fontSize: '12px', color: '#999' }}>{currentOracle.oracle_id}</span></p>
                <p style={{ fontSize: '18px', margin: '15px 0' }}>
                  <strong>BTC Oracle Price:</strong>{' '}
                  <span style={{ color: '#00e676', fontWeight: 'bold', fontSize: '24px' }}>
                    {currentOracle.price ? `$ ${(Number(currentOracle.price) / 1000000000).toFixed(4)}` : "Loading..."}
                  </span>
                </p>
                <p><strong>Strike Price:</strong> $ {customStrike}</p>
                <p>
                  <strong>Expiry:</strong>{' '}
                  <span style={{ color: '#ff9100', fontWeight: 'bold' }}>
                    {new Date(currentOracle.expiry).toLocaleTimeString()} ({getCountdown(currentOracle.expiry)})
                  </span>
                </p>
                <p><strong>Oracle Status:</strong> <span style={{ color: '#29b6f6' }}>{currentOracle.status.toUpperCase()}</span></p>
              </div>
            ) : (
              <p style={{ color: '#aaa', margin: 0 }}>Searching for the latest active 15-minute BTC Oracle and subscribing to its price data...</p>
            )}
          </div>
        </div>

        {/* Right column: Step 3 */}
        <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '5px' }}>
          <h3 style={{ marginTop: 0 }}>🎯 Option Order Placement (STEP 3)</h3>
          {account && managerId && currentOracle ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Strike price input box */}
              <div>
                <label><strong>1. Manual Strike Price (USD): </strong></label>
                <div style={{ display: 'flex', alignItems: 'center', marginTop: '5px', gap: '10px' }}>
                  <input 
                    type="number" 
                    value={customStrike} 
                    onChange={(e) => setCustomStrike(e.currentTarget.value)}
                    placeholder="e.g. 65230.5"
                    style={{ padding: '6px', width: '150px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                  />
                  <button 
                    onClick={() => currentOracle.price && setCustomStrike((Number(currentOracle.price) / 1000000000).toFixed(2))}
                    style={{ fontSize: '11px', cursor: 'pointer', padding: '6px 12px' }}
                  >
                    Use Current Price
                  </button>
                </div>
              </div>

              {/* Direction selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label><strong>2. Prediction Direction (UP / DOWN): </strong></label>
                <select 
                  value={direction} 
                  onChange={(e) => setDirection(e.currentTarget.value as 'UP' | 'DOWN')}
                  style={{ padding: '6px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', width: '100%' }}
                >
                  <option value="UP">📈 UP (Call - settlement price higher strike)</option>
                  <option value="DOWN">📉 DOWN (Put - settlement price lower strike)</option>
                </select>
              </div>

              {/* Order quantity */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label><strong>3. Order Quantity (DUSDC): </strong></label>
                <input 
                  type="number" 
                  value={quantity} 
                  onChange={(e) => setQuantity(e.currentTarget.value)}
                  style={{ padding: '6px', width: '120px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                />
              </div>

              {/* Trigger order button */}
              <button 
                onClick={handleMintPosition} 
                disabled={minting || !customStrike}
                style={{ 
                  padding: '12px', 
                  background: '#6200ea', 
                  color: '#fff', 
                  border: 'none', 
                  borderRadius: '4px', 
                  fontWeight: 'bold', 
                  cursor: minting ? 'not-allowed' : 'pointer',
                  marginTop: '15px'
                }}
              >
                {minting ? 'Sending Transaction...' : '🚀 Send Mint Transaction'}
              </button>
            </div>
          ) : (
            <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>Please ensure you have: connected wallet, bound PredictManager, and have an active Oracle to unlock fast order placement.</p>
          )}
        </div>
      </div>
    </div>
  );
}
