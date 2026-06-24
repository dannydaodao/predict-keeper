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
    tx.setGasBudget(100000000n); // Explicitly set a safe gas budget (e.g., 0.1 SUI)

    try {
        const signer = getSigner();
        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer,
            options: { showEffects: true },
        });

        // 无论成功还是失败，只要有 gasObject 返回，就立即用它更新本地缓存
        // 这样可以 100% 避开 RPC 的最终一致性延迟，拿到绝对正确的最新版本
        const mutatedGas = result.effects?.gasObject;
        if (mutatedGas) {
            cachedGasCoin = {
                objectId: mutatedGas.reference.objectId,
                version: mutatedGas.reference.version,
                digest: mutatedGas.reference.digest
            };
        }

        if (result.effects?.status.status === 'success') {
            console.log(`✅ Batch redemption succeeded! TX Digest: ${result.digest}`);
        } else {
            console.error(`❌ Redemption failed:`, result.effects?.status.error);
            // 如果是因为 InsufficientGas 失败，说明是预算问题，这里无需设 cachedGasCoin 为 null，它已经在上面被更新为链上最新版本了
        }
    } catch (error) {
        console.error("Exception occurred during TX execution:", error);
        
        // 1. 立即降级：清空本地缓存，保证下一笔可能在几十毫秒内触发的交易能降级走 SDK 自动配 Gas 逻辑，绝不卡死
        cachedGasCoin = null;
        
        // 2. 延迟 1 秒后异步刷新：给 Sui RPC 节点充裕的时间完成数据同步和索引
        setTimeout(() => {
            console.log("🔄 [Lazy Recovery] 1s delay passed, refreshing Gas Cache to restore fast-path...");
            refreshGasCoinCache().catch(err => console.error("Failed to lazy refresh Gas cache:", err));
        }, 5000);
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
        if (!chosenCoin) {
            throw new Error(`❌ No SUI coin found`);
        }
        
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
