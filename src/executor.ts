import { Transaction } from '@mysten/sui/transactions';
import { getClient, getSigner } from './utils';
import { CONFIG } from './config';
import { RedeemablePosition } from './scanner';

const client = getClient(CONFIG.NETWORK);

export async function executeRedeemBatch(positions: RedeemablePosition[]) {
    if (positions.length === 0) return;

    console.log(`准备为 ${positions.length} 个头寸执行代领...`);
    const tx = new Transaction();

    for (const pos of positions) {
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

    try {
        const signer = getSigner();
        const result = await client.signAndExecuteTransaction({
            transaction: tx,
            signer,
            options: { showEffects: true },
        });

        if (result.effects?.status.status === 'success') {
            console.log(`✅ 批量代领成功！交易 Digest: ${result.digest}`);
        } else {
            console.error(`❌ 代领失败:`, result.effects?.status.error);
        }
    } catch (error) {
        console.error("执行交易时发生异常:", error);
    }
}