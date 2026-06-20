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

  // Oracle 的前端渲染状态
  const [currentOracle, setCurrentOracle] = useState<OracleData | null>(null);

  // 🔥 3. 新增下单功能参数对应的 React State 状态
  const [customStrike, setCustomStrike] = useState<string>(''); // 手动指定价格 (行权价，单位为美元)
  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP'); // 选择方向 (看涨/看跌)
  const [quantity, setQuantity] = useState<string>('10'); // 投注数量 (DUSDC)
  const [minting, setMinting] = useState(false); // 投注状态 Loading

  // 1. 查询钱包的 DUSDC 余额及 PredictManager
  useEffect(() => {
    if (!account) {
      setDusdcBalance(null);
      setManagerId(null);
      return;
    }
    
    fetchUserStatus();
  }, [account, suiClient]);

  // 2秒轮询：高频获取最新 Oracle 及其价格
  useEffect(() => {
    fetchLastestOracle(); // 初始化加载

    const interval = setInterval(() => {
      fetchLastestOracle();
    }, 2000); // 2000 毫秒 = 2 秒

    return () => clearInterval(interval);
  }, []);

  const fetchUserStatus = async () => {
    if (!account) return;
    setLoading(true);
    try {
      // 查询 DUSDC 余额
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
        await fetchManagerDUSDC(manager[0].manager_id); // 查询 PredictManager DUSDC 余额
      }
    } catch (err) {
      console.error("查询用户资产/管理器状态失败:", err);
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
      console.error("查询 PredictManager DUSDC 余额失败:", err);
    }
  }

  // 一键创建 PredictManager 交易
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

      console.log("创建 PredictManager 交易成功:", result);
      // 稍等 2 秒等待索引后刷新
      setTimeout(fetchUserStatus, 2000);
    } catch (err) {
      console.error("创建 PredictManager 失败:", err);
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
        console.log("当前暂无已激活且发布了价格的 Oracle。");
        setCurrentOracle(null);
        return null;
      }

      activeOracles.sort((a: any, b: any) => (a.expiry > b.expiry ? 1 : a.expiry < b.expiry ? -1 : 0));
      const latestOracle = activeOracles[0];
      
      const pricesUrl = `${CONFIG.SERVER_URL}/oracles/${latestOracle.oracle_id}/prices/latest`;
      const prices = await fetch(pricesUrl).then(res => res.json());
      
      const currentPrice = prices ? prices.forward : null;

      // 自动将最新价格同步到手动指定行权价的初始默认值中 (如果还没手动输入)
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
      console.error("查询最新 Oracle 失败:", err);
      return null;
    }
  }

  // 🔥 4. 处理下单 Mint 功能
  const handleMintPosition = async () => {
    if (!account || !managerId || !currentOracle) {
      alert("请连接钱包、绑定 PredictManager 并确保加载了最新的 Oracle！");
      return;
    }

    setMinting(true);
    try {
      // a. 计算参数
      // Sui 预言机行权价 Strike 需要乘以 10^9 还原为 scale，例如 65000 美元 -> 65000 * 1e9
      const strikeScaled = BigInt(Math.floor(Number(customStrike) * 1000000000));
      // DUSDC Decimals 为 6
      const quantityScaled = BigInt(Math.floor(Number(quantity) * 1000000));
      const isUp = direction === 'UP';

      console.log(`🚀 发起 Mint 下单交易：`);
      console.log(`   Oracle ID:  ${currentOracle.oracle_id}`);
      console.log(`   Expiry:     ${currentOracle.expiry}`);
      console.log(`   Strike:     ${strikeScaled.toString()}`);
      console.log(`   Direction:  ${direction}`);
      console.log(`   Quantity:   ${quantityScaled.toString()}`);

      const tx = new Transaction();

      // b. 在链上本地构造 MarketKey
      const marketKey = tx.moveCall({
        target: `${CONFIG.PREDICT_PACKAGE_ID}::market_key::new`,
        arguments: [
          tx.pure.id(currentOracle.oracle_id),
          tx.pure.u64(currentOracle.expiry),
          tx.pure.u64(strikeScaled),
          tx.pure.bool(isUp),
        ],
      });

      // c. 调用 predict::mint
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

      // d. 签名并执行交易
      const result = await signAndExecute({
        transaction: tx,
      });

      console.log("✅ 下单 Mint 成功:", result);
      alert(`下单成功！交易哈希: ${result.digest}`);

      // 延迟 2 秒刷新钱包状态
      setTimeout(fetchUserStatus, 2000);
    } catch (err: any) {
      console.error("❌ 下单 Mint 失败:", err);
      alert(`下单失败: ${err.message || err}`);
    } finally {
      setMinting(false);
    }
  };

  // 辅助函数：格式化过期倒计时
  const getCountdown = (expiryTimestamp: number) => {
    const diff = expiryTimestamp - Date.now();
    if (diff <= 0) return "已到期，等待结算";
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}分${seconds}秒`;
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #444', paddingBottom: '10px' }}>
        <h2 style={{ margin: 0 }}>🔮 Predict Keeper 调试中心</h2>
        <ConnectButton />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', alignItems: 'start' }}>
        {/* 左侧栏：Step 1 & Step 2 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 模块1：用户状态与资产信息 */}
          {account ? (
            <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '5px' }}>
              <h3 style={{ marginTop: 0 }}>👤 账户基本状态 (STEP 1)</h3>
              <p><strong>钱包地址:</strong> {account.address}</p>
              <p><strong>DUSDC 数量:</strong> {loading ? '查询中...' : `${dusdcBalance ?? '0.00'} DUSDC`}</p>
              <p>
                <strong>PredictManager 地址:</strong>{' '}
                {loading ? (
                  '查询中...'
                ) : managerId ? (
                  <span style={{ color: 'green', fontWeight: 'bold' }}>{managerId}</span>
                ) : (
                  <span>
                    <span style={{ color: 'red' }}>未创建</span>{' '}
                    <button 
                      onClick={handleCreateManager} 
                      disabled={creating}
                      style={{ marginLeft: '10px', cursor: 'pointer' }}
                    >
                      {creating ? '正在创建...' : '一键创建'}
                    </button>
                  </span>
                )}
              </p>
              <button onClick={fetchUserStatus} style={{ marginTop: '10px', cursor: 'pointer' }}>
                手动刷新账户
              </button>
            </div>
          ) : (
            <p style={{ color: '#aaa', margin: 0 }}>请点击右上角按钮连接钱包以激活测试。</p>
          )}

          {/* 模块2：Oracle 价格动态监控 (STEP 2) */}
          <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '5px' }}>
            <h3 style={{ marginTop: 0 }}>📡 BTC 预言机实时数据 (STEP 2)</h3>
            {currentOracle ? (
              <div>
                <p><strong>最新活跃 Oracle ID:</strong> <span style={{ fontSize: '12px', color: '#999' }}>{currentOracle.oracle_id}</span></p>
                <p style={{ fontSize: '18px', margin: '15px 0' }}>
                  <strong>BTC 预言机价格:</strong>{' '}
                  <span style={{ color: '#00e676', fontWeight: 'bold', fontSize: '24px' }}>
                    {currentOracle.price ? `$ ${(Number(currentOracle.price) / 1000000000).toFixed(4)}` : "获取中..."}
                  </span>
                </p>
                <p><strong>结算行权价 Strike:</strong> $ {customStrike}</p>
                <p>
                  <strong>到期时间 Expiry:</strong>{' '}
                  <span style={{ color: '#ff9100', fontWeight: 'bold' }}>
                    {new Date(currentOracle.expiry).toLocaleTimeString()} ({getCountdown(currentOracle.expiry)})
                  </span>
                </p>
                <p><strong>预言机状态:</strong> <span style={{ color: '#29b6f6' }}>{currentOracle.status.toUpperCase()}</span></p>
              </div>
            ) : (
              <p style={{ color: '#aaa', margin: 0 }}>正在搜寻最新活跃的 15 分钟 BTC 预言机并订阅其价格数据...</p>
            )}
          </div>
        </div>

        {/* 右侧栏：Step 3 */}
        <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '5px' }}>
          <h3 style={{ marginTop: 0 }}>🎯 期权投注下单 (STEP 3)</h3>
          {account && managerId && currentOracle ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 行权价输入框 */}
              <div>
                <label><strong>1. 手动指定价格 (USD): </strong></label>
                <div style={{ display: 'flex', alignItems: 'center', marginTop: '5px', gap: '10px' }}>
                  <input 
                    type="number" 
                    value={customStrike} 
                    onChange={(e) => setCustomStrike(e.target.value)}
                    placeholder="例如: 65230.5"
                    style={{ padding: '6px', width: '150px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                  />
                  <button 
                    onClick={() => currentOracle.price && setCustomStrike((Number(currentOracle.price) / 1000000000).toFixed(2))}
                    style={{ fontSize: '11px', cursor: 'pointer', padding: '6px 12px' }}
                  >
                    用当前价
                  </button>
                </div>
              </div>

              {/* 方向选择 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label><strong>2. 预测方向 (UP / DOWN): </strong></label>
                <select 
                  value={direction} 
                  onChange={(e) => setDirection(e.target.value as 'UP' | 'DOWN')}
                  style={{ padding: '6px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', width: '100%' }}
                >
                  <option value="UP">📈 UP (看涨 - 结算价高于行权价)</option>
                  <option value="DOWN">📉 DOWN (看跌 - 结算价低于行权价)</option>
                </select>
              </div>

              {/* 下单数量 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label><strong>3. 下单数量 (DUSDC): </strong></label>
                <input 
                  type="number" 
                  value={quantity} 
                  onChange={(e) => setQuantity(e.target.value)}
                  style={{ padding: '6px', width: '120px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
                />
              </div>

              {/* 触发下单按钮 */}
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
                {minting ? '正在打包发送交易...' : '🚀 发送 Mint 下单交易'}
              </button>
            </div>
          ) : (
            <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>请确保已经：连接钱包、绑定了 PredictManager 且当前有活跃的 Oracle，即可解锁极速下单功能。</p>
          )}
        </div>
      </div>
    </div>
  );
}
