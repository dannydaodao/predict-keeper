import { Transaction } from '@mysten/sui/transactions';
import { getClient, getSigner } from './utils';
import { CONFIG } from './config';
import { RedeemablePosition } from './scanner';
import { log } from 'console';

const client = getClient(CONFIG.NETWORK);

export interface GasCoinRef {
    objectId: string;
    version: string;
    digest: string;
}

let cachedGasCoin: GasCoinRef | null = null;
let referenceGasPrice: bigint = 1000n; // 可以设一个稍微高于 750n（比如 1000n）的安全值，避免向 RPC 查询

export async function executeRedeemBatch(positions: RedeemablePosition[]) {
    if (positions.length === 0) return;

    console.log(`准备为 ${positions.length} 个头寸执行代领...`);
    const tx = new Transaction();

    for (const pos of positions) {
        console.log(`构建代领交易: Manager ${pos.managerId}, Oracle ${pos.oracleId}, marketKey ${pos.oracleId}`);
        // 先利用 tx.moveCall 构造 MarketKey 实例
        const marketKey = tx.moveCall({
            target: `${CONFIG.PREDICT_PACKAGE_ID}::market_key::new`,
            arguments: [
                tx.pure.id(pos.marketKey.oracle_id),
                tx.pure.u64(pos.marketKey.expiry),
                tx.pure.u64(pos.marketKey.strike),
                tx.pure.bool(pos.marketKey.is_up),
            ],
        });
        console.log("构建 MarketKey:", pos);

        // 打包 redeem_permissionless
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
    tx.setGasPrice(referenceGasPrice); // 显式设置，不让 SDK 去 RPC 查 Gas 价格
    tx.setGasBudget(10000000n); // 显式设置一个安全的 Gas Budget（如 0.01 SUI）

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
            console.log(`✅ 批量代领成功！交易 Digest: ${result.digest}`);
        } else {
            console.error(`❌ 代领失败:`, result.effects?.status.error);
            cachedGasCoin = null;
            refreshGasCoinCache();
        }
    } catch (error) {
        console.error("执行交易时发生异常:", error);
    }
}

export async function refreshGasCoinCache(): Promise<GasCoinRef | null> {
    try {
        const signer = getSigner();
        const keeperAddress = signer.toSuiAddress();
        
        console.log(`📡 正在为 Keeper 地址 [${keeperAddress}] 刷新 Gas 缓存...`);

        // 1. 获取当前网路的最新参考 Gas 价格
        try {
            const systemGasPrice = await client.getReferenceGasPrice();
            // 设为参考价格的 1.1 ~ 1.2 倍，利于在抢跑竞争中被验证者优先打包
            referenceGasPrice = (BigInt(systemGasPrice) * 120n) / 100n;
        } catch (e) {
            console.warn("⚠️ 获取链上 Gas 价格失败，使用默认 1000n MIST", e);
            referenceGasPrice = 1000n;
        }

        // 2. 获取所有的 SUI Coin
        const coinsResult = await client.getCoins({
            owner: keeperAddress,
            coinType: '0x2::sui::SUI',
            limit: 20, // 查找前20个
        });

        if (!coinsResult.data || coinsResult.data.length === 0) {
            throw new Error(`❌ 你的 Keeper 地址 [${keeperAddress}] 没有任何 SUI 代币，无法作为 Gas 支付！`);
        }

        // 3. 过滤并找到余额最大、能付得起 Gas（比如大于 0.1 SUI = 100,000,000 MIST）的 Coin Object
        // 竞争机器人尽量用一个大额的 Coin 专门用来支付，防止频繁拆分（Coin Split）
        const suitableCoin = coinsResult.data
            .filter(coin => BigInt(coin.balance) > 100000000n) // 大于 0.1 SUI
            .sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))[0]; // 按余额从大到小排序，取最大的

        const chosenCoin = suitableCoin || coinsResult.data[0]; // 如果没有大于 0.1 SUI 的，就取第一个
        
        cachedGasCoin = {
            objectId: chosenCoin.coinObjectId,
            version: chosenCoin.version,
            digest: chosenCoin.digest,
        };

        console.log(`✅ Gas 缓存刷新成功！`);
        console.log(`   Gas Object ID: ${cachedGasCoin.objectId}`);
        console.log(`   余额 (MIST):   ${chosenCoin.balance}`);
        console.log(`   设置 Gas Price: ${referenceGasPrice}`);
        return cachedGasCoin;

    } catch (error) {
        console.error("❌ 刷新 Gas 缓存失败:", error);
        cachedGasCoin = null;
        return null;
    }
}