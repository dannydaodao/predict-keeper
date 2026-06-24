import { Transaction } from '@mysten/sui/transactions';
import { getClient, getSigner } from './utils';
import { CONFIG } from './config';
import type { RedeemablePosition } from './scanner';
import { log } from 'console';

const client = getClient(CONFIG.NETWORK);

export interface GasCoinRef {
    objectId: string;
    version: string;
    digest: string;
}

let cachedGasCoin: GasCoinRef | null = null;
let referenceGasPrice: bigint = 1000n; // Safe value slightly above 750n (e.g., 1000n) to avoid RPC querying

export async function executeRedeemBatch(positions: RedeemablePosition[]) {
    if (positions.length === 0) return;

    console.log(`Preparing to redeem for ${positions.length} positions...`);
    const tx = new Transaction();

    for (const pos of positions) {
        console.log(`Building redemption TX: Manager ${pos.managerId}, Oracle ${pos.oracleId}, marketKey ${pos.oracleId}`);
        // First construct MarketKey instance via tx.moveCall
        const marketKey = tx.moveCall({
            target: `${CONFIG.PREDICT_PACKAGE_ID}::market_key::new`,
            arguments: [
                tx.pure.id(pos.marketKey.oracle_id),
                tx.pure.u64(pos.marketKey.expiry),
                tx.pure.u64(pos.marketKey.strike),
                tx.pure.bool(pos.marketKey.is_up),
            ],
        });
        console.log("Built MarketKey:", pos);

        // Pack redeem_permissionless
        tx.moveCall({
            target: `${CONFIG.PREDICT_PACKAGE_ID}::predict::redeem_permissionless`,
            typeArguments: [CONFIG.DUSDC_TYPE],
            arguments: [
                tx.object(CONFIG.PREDICT_OBJECT_ID),
                tx.object(pos.managerId),
                tx.object(pos.oracleId),
                marketKey,
                tx.pure.u64(pos.quantity),
                tx.object(CONFIG.CLOCK_ID),
            ],
        });
    }

    if (cachedGasCoin) {
        tx.setGasPayment([cachedGasCoin]);
    }
    tx.setGasPrice(referenceGasPrice); // Explicitly set gas price to avoid SDK querying RPC
    tx.setGasBudget(10000000n); // Explicitly set a safe gas budget (e.g., 0.01 SUI)

    try {
        const signer = getSigner();
        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer,
            options: { showEffects: true },
        });

        if (result.effects?.status.status === 'success') {
            const mutatedGas = result.effects.gasObject;
            if (mutatedGas) {
                cachedGasCoin = {
                    objectId: mutatedGas.reference.objectId,
                    version: mutatedGas.reference.version,
                    digest: mutatedGas.reference.digest
                };
            }
            console.log(`✅ Batch redemption succeeded! TX Digest: ${result.digest}`);
        } else {
            console.error(`❌ Redemption failed:`, result.effects?.status.error);
            cachedGasCoin = null;
            refreshGasCoinCache();
        }
    } catch (error) {
        console.error("Exception occurred during TX execution:", error);
        refreshGasCoinCache();
    }
}

export async function refreshGasCoinCache(): Promise<GasCoinRef | null> {
    try {
        const signer = getSigner();
        const keeperAddress = signer.toSuiAddress();
        
        console.log(`📡 Refreshing Gas Cache for Keeper [${keeperAddress}]...`);

        // 1. Get reference gas price of the current network
        try {
            const systemGasPrice = await client.getReferenceGasPrice();
            // Set to 1.1 ~ 1.2 times reference price for prioritized packaging by validators in front-running competition
            referenceGasPrice = (BigInt(systemGasPrice) * 120n) / 100n;
        } catch (e) {
            console.warn("⚠️ Failed to fetch on-chain gas price, using default 1000n MIST", e);
            referenceGasPrice = 1000n;
        }

        // 2. Get all SUI Coins
        const coinsResult = await client.getCoins({
            owner: keeperAddress,
            coinType: '0x2::sui::SUI',
            limit: 20, // search first 20
        });

        if (!coinsResult.data || coinsResult.data.length === 0) {
            throw new Error(`❌ Keeper [${keeperAddress}] does not have any SUI tokens to pay for gas!`);
        }

        // 3. Filter and find the Coin Object with maximum balance capable of paying gas (e.g. > 0.1 SUI = 100,000,000 MIST)
        // Try to use a single large Coin for payment to prevent frequent coin splitting
        const suitableCoin = coinsResult.data
            .filter(coin => BigInt(coin.balance) > 100000000n) // greater than 0.1 SUI
            .sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))[0]; // sorted descending, take largest

        const chosenCoin = suitableCoin || coinsResult.data[0]; // if none > 0.1 SUI, take the first one
        
        cachedGasCoin = {
            objectId: chosenCoin.coinObjectId,
            version: chosenCoin.version,
            digest: chosenCoin.digest,
        };

        console.log(`✅ Gas cache refreshed successfully!`);
        console.log(`   Gas Object ID: ${cachedGasCoin.objectId}`);
        console.log(`   Balance (MIST):   ${chosenCoin.balance}`);
        console.log(`   Gas Price set: ${referenceGasPrice}`);
        return cachedGasCoin;

    } catch (error) {
        console.error("❌ Failed to refresh gas cache:", error);
        cachedGasCoin = null;
        return null;
    }
}
