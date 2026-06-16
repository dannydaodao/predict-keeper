import { Transaction } from '@mysten/sui/transactions';
import { getClient } from './utils';
import { CONFIG } from './config';
import { log } from 'console';
import { waitForDebugger } from 'inspector';

    const client = getClient(CONFIG.NETWORK);
    const tx = new Transaction();
// 定义我们需要找到的“猎物”结构
export interface RedeemablePosition {
    managerId: string;
    oracleId: string;
    marketKey: {
        oracle_id: string;
        expiry: bigint;
        strike: bigint;
        is_up: boolean;
    };
    quantity: bigint;
}

/**
 * 二元期权赢家判断逻辑
 * @param settlementPrice 结算价
 * @param strike 行权价
 * @param isUp 是否看涨
 */
function isWinningPosition(settlementPrice: bigint, strike: bigint, isUp: boolean): boolean {
    if (isUp) {
        return settlementPrice >= strike;
    } else {
        return settlementPrice < strike;
    }
}

export async function findRedeemablePositions(): Promise<RedeemablePosition[]> {
    console.log("=== 正在运行【逆向精准索引】增量扫描 ===");
    const redeemablePositions: RedeemablePosition[] = [];

    try {
        // 1. 获取所有的 Oracles，筛选出已经结算且有价格的
        const oraclesUrl = `${CONFIG.SERVER_URL}/predicts/${CONFIG.PREDICT_OBJECT_ID}/oracles`;
        const oracles = await fetch(oraclesUrl).then(res => res.json());

        const settledOracles: Array<{ id: string, price: bigint, settledAt: bigint }> = [];
        for (const oracle of oracles) {
            if (oracle.status.toLowerCase() === 'settled' && oracle.settlement_price !== null) {
                settledOracles.push({
                    id: oracle.oracle_id,
                    price: BigInt(oracle.settlement_price),
                    settledAt: BigInt(oracle.settled_at)
                });
            }
        }
        settledOracles.sort((a, b) => (b.settledAt > a.settledAt ? 1 : b.settledAt < a.settledAt ? -1 : 0));
        if (settledOracles.length === 0) {
            console.log("当前暂无已结算且发布了价格的 Oracle，跳过本次轮询。");
            return [];
        }

        console.log(`发现已结算的 Oracle 数量: ${settledOracles.length}，开始精准锁定中奖用户...`);

        // 2. 针对每一个已结算的 Oracle 运行逆向索引
        for (const oracle of settledOracles) {
            console.log(`\n🔍 正在扫描结算 Oracle [${oracle.id}]...`);

            // 【关键 API 路由：/positions/minted?oracle_id=...】
            const mintedUrl = `${CONFIG.SERVER_URL}/positions/minted?oracle_id=${oracle.id}`;
            const mintedRecords = await fetch(mintedUrl).then(res => res.json());

            if (!mintedRecords || mintedRecords.length === 0) {
                console.log(`-> 没有用户在该 Oracle 下单过。`);
                continue;
            }

            const redeemedUrl = `${CONFIG.SERVER_URL}/positions/redeemed?oracle_id=${oracle.id}`;
            const redeemedRecords = await fetch(redeemedUrl).then(res => res.json());

            if (redeemedRecords && redeemedRecords.length === mintedRecords.length) {
                console.log("have redeemed all positions, oracleId: ", oracle.id);
                continue;
            }

            const waitForReddemed = mintedRecords.filter((minted: any) => {
                return !redeemedRecords.some((redeemed: any) => 
                    redeemed.manager_id === minted.manager_id 
                    && redeemed.expiry === minted.expiry
                    && redeemed.strike === minted.strike
                    && redeemed.is_up === minted.is_up
                );
            });

            for(const record of waitForReddemed){
                const strikePrice = BigInt(record.strike);
                const isUp = record.is_up;
                // 过滤：只代领猜中的单子 (won)

                if (isWinningPosition(oracle.price, strikePrice, isUp)) {
                    redeemablePositions.push({
                        managerId: record.manager_id,
                        oracleId: record.oracle_id,
                        marketKey: {
                            oracle_id: record.oracle_id,
                            expiry: BigInt(record.expiry),
                            strike: strikePrice,
                            is_up: isUp
                        },
                        quantity: BigInt(record.quantity)
                    });
                    //                     redeemablePositions.push({
                    //     managerId: "0x42a4c7e19819c797698df2625908234e83cb3499606726c53fe02870a45c05e0",
                    //     oracleId: "0xee875b4697826cc0fed3f3808c79375a26d5f264caf0f2a480bab2c93ffc1ff5",
                    //     marketKey: {
                    //         oracle_id: "0xee875b4697826cc0fed3f3808c79375a26d5f264caf0f2a480bab2c93ffc1ff5",
                    //         expiry: 1781534700000n,
                    //         strike: 66484000000000n,
                    //         is_up: isUp
                    //     },
                    //     quantity: 7017856n,
                    // });

    //                     positions.push({
    // managerId: "0x926cbf800a051d8d93ac4d1ff9a049116ffd7c3705fe33baf5b45ac981f8b082",
    // oracleId: "0x169c5df118f4655fcb6404bd8e1d328f0bf0789855c7511236a48d936b4f01e3",
    // marketKey: {
    //     oracle_id: "0x169c5df118f4655fcb6404bd8e1d328f0bf0789855c7511236a48d936b4f01e3",
    //     expiry: 1780398900000n,
    //     strike: 69200n * 1_000_000_000n,
    //     is_up: true,
    // },
    // quantity: 10n * 1_000_000n,
    // });
                    console.log(`   🎯 [赢家锁定] 账户 ${record.manager_id} 猜中！(Strike: ${strikePrice}, UP: ${isUp}) 待领数量: ${record.quantity} digest : ${record.digest}`);
                    break;
                } else {
                    console.log(`   💨 [亏损略过] 账户 ${record.manager_id} 猜错。(Strike: ${strikePrice}, UP: ${isUp}) 不代领。`);
                }
            }
            if(redeemablePositions.length > 0){
                console.warn("⚠️ 发现过多可代领头寸，当前仅锁定前 100 个，建议加快执行速度！");
                break;
            }

        }

    } catch (error) {
        console.error("逆向精准扫描发生故障:", error);
    }

    console.log(`\n=== 扫描结束，共锁定可代领中奖头寸: ${redeemablePositions.length} 个 ===`);
    return redeemablePositions;
}


export async function findSingleOraclePositions(oracle: { id: string, price: bigint }): Promise<RedeemablePosition[]> {
    console.log("findSingleOraclePositions === 正在运行【单 Oracle 精准索引】增量扫描 === oracleId: ", oracle.id, " settledPrice: ", oracle.price);
    const redeemablePositions: RedeemablePosition[] = [];

    try {
            console.log(`\n🔍 正在扫描结算 Oracle [${oracle.id}]...`);

            // 【关键 API 路由：/positions/minted?oracle_id=...】
            const mintedUrl = `${CONFIG.SERVER_URL}/positions/minted?oracle_id=${oracle.id}`;
            const mintedRecords = await fetch(mintedUrl).then(res => res.json());

            if (!mintedRecords || mintedRecords.length === 0) {
                console.log(`-> 没有用户在该 Oracle 下单过。`);
                return [];
            }

            const redeemedUrl = `${CONFIG.SERVER_URL}/positions/redeemed?oracle_id=${oracle.id}`;
            const redeemedRecords = await fetch(redeemedUrl).then(res => res.json());

            if (redeemedRecords && redeemedRecords.length === mintedRecords.length) {
                console.log("have redeemed all positions, oracleId: ", oracle.id);
                return [];
            }

            const waitForReddemed = mintedRecords.filter((minted: any) => {
                return !redeemedRecords.some((redeemed: any) => 
                    redeemed.manager_id === minted.manager_id 
                    && redeemed.expiry === minted.expiry
                    && redeemed.strike === minted.strike
                    && redeemed.is_up === minted.is_up
                );
            });

            for(const record of waitForReddemed){
                const strikePrice = BigInt(record.strike);
                const isUp = record.is_up;
                // 过滤：只代领猜中的单子 (won)

                if (isWinningPosition(oracle.price, strikePrice, isUp)) {
                    redeemablePositions.push({
                        managerId: record.manager_id,
                        oracleId: record.oracle_id,
                        marketKey: {
                            oracle_id: record.oracle_id,
                            expiry: BigInt(record.expiry),
                            strike: strikePrice,
                            is_up: isUp
                        },
                        quantity: BigInt(record.quantity)
                    });
                    console.log(`   🎯 [赢家锁定] 账户 ${record.manager_id} 猜中！(Strike: ${strikePrice}, UP: ${isUp}) 待领数量: ${record.quantity} digest : ${record.digest}`);
                    break;
                } else {
                    console.log(`   💨 [亏损略过] 账户 ${record.manager_id} 猜错。(Strike: ${strikePrice}, UP: ${isUp}) 不代领。`);
                }
        }

    } catch (error) {
        console.error("逆向精准扫描发生故障:", error);
    }

    console.log(`\n=== 扫描结束，共锁定可代领中奖头寸: ${redeemablePositions.length} 个 ===`);
    return redeemablePositions;
}
