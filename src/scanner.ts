import { Transaction } from '@mysten/sui/transactions';
import { getClient } from './utils';
import { CONFIG } from './config';
import { log } from 'console';
import { waitForDebugger } from 'inspector';

    const client = getClient(CONFIG.NETWORK);
    const tx = new Transaction();
// Define the structure of target redeemable positions
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
 * Binary option winning determination logic
 * @param settlementPrice Settlement Price
 * @param strike Strike Price
 * @param isUp Is Call Option
 */
function isWinningPosition(settlementPrice: bigint, strike: bigint, isUp: boolean): boolean {
    if (isUp) {
        return settlementPrice >= strike;
    } else {
        return settlementPrice < strike;
    }
}

export async function findRedeemablePositions(): Promise<RedeemablePosition[]> {
    console.log("=== Running [Reverse Precision Index] incremental scan ===");
    const redeemablePositions: RedeemablePosition[] = [];

    try {
        // 1. Get all Oracles, filtering for settled ones with a price
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
            console.log("No settled oracles with published price found, skipping this polling interval.");
            return [];
        }

        console.log(`Found settled oracle count: ${settledOracles.length}, starting precise winner detection...`);

        // 2. Run reverse index scanning for each settled Oracle
        for (const oracle of settledOracles) {
            console.log(`\n🔍 Scanning settled Oracle [${oracle.id}]...`);

            // [Key API Route: /positions/minted?oracle_id=...]
            const mintedUrl = `${CONFIG.SERVER_URL}/positions/minted?oracle_id=${oracle.id}`;
            const mintedRecords = await fetch(mintedUrl).then(res => res.json());

            if (!mintedRecords || mintedRecords.length === 0) {
                console.log(`-> No users placed orders on this Oracle.`);
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
                // Filtering: only claim for calls/puts that won

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
                    console.log(`   🎯 [Winner Locked] Account ${record.manager_id} won! (Strike: ${strikePrice}, UP: ${isUp}) Quantity pending: ${record.quantity} digest: ${record.digest}`);
                    break;
                } else {
                    console.log(`   💨 [Loss Skipped] Account ${record.manager_id} lost. (Strike: ${strikePrice}, UP: ${isUp}) Skipping redemption.`);
                }
            }
            if(redeemablePositions.length > 0){
                console.warn("⚠️ Too many redeemable positions found, only locking the top 100, suggest accelerating execution speed!");
                break;
            }

        }

    } catch (error) {
        console.error("Reverse precise scan encountered error:", error);
    }

    console.log(`\n=== Scan ended, locked ${redeemablePositions.length} redeemable winning positions in total ===`);
    return redeemablePositions;
}


export async function findSingleOraclePositions(oracle: { id: string, price: bigint }): Promise<RedeemablePosition[]> {
    console.log("findSingleOraclePositions === Running [Single Oracle Precision Index] incremental scan === oracleId: ", oracle.id, " settledPrice: ", oracle.price);
    const redeemablePositions: RedeemablePosition[] = [];

    try {
            console.log(`\n🔍 Scanning settled Oracle [${oracle.id}]...`);

            // [Key API Route: /positions/minted?oracle_id=...]
            const mintedUrl = `${CONFIG.SERVER_URL}/positions/minted?oracle_id=${oracle.id}`;
            const mintedRecords = await fetch(mintedUrl).then(res => res.json());

            if (!mintedRecords || mintedRecords.length === 0) {
                console.log(`-> No users placed orders on this Oracle.`);
                return [];
            }

            // const redeemedUrl = `${CONFIG.SERVER_URL}/positions/redeemed?oracle_id=${oracle.id}`;
            // const redeemedRecords = await fetch(redeemedUrl).then(res => res.json());

            // if (redeemedRecords && redeemedRecords.length === mintedRecords.length) {
            //     console.log("have redeemed all positions, oracleId: ", oracle.id);
            //     return [];
            // }

            // const waitForReddemed = mintedRecords.filter((minted: any) => {
            //     return !redeemedRecords.some((redeemed: any) => 
            //         redeemed.manager_id === minted.manager_id 
            //         && redeemed.expiry === minted.expiry
            //         && redeemed.strike === minted.strike
            //         && redeemed.is_up === minted.is_up
            //     );
            // });

            for(const record of mintedRecords){
                const strikePrice = BigInt(record.strike);
                const isUp = record.is_up;
                // Filtering: only claim for calls/puts that won

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
                    console.log(`   🎯 [Winner Locked] Account ${record.manager_id} won! (Strike: ${strikePrice}, UP: ${isUp}) Quantity pending: ${record.quantity} digest: ${record.digest}`);
                    break;
                } else {
                    console.log(`   💨 [Loss Skipped] Account ${record.manager_id} lost. (Strike: ${strikePrice}, UP: ${isUp}) Skipping redemption.`);
                }
        }

    } catch (error) {
        console.error("Reverse precise scan encountered error:", error);
    }

    console.log(`\n=== Scan ended, locked ${redeemablePositions.length} redeemable winning positions in total ===`);
    return redeemablePositions;
}
