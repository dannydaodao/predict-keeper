import { Transaction } from '@mysten/sui/transactions';
import { getClient } from './utils';
import { CONFIG } from './config';

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

export async function findRedeemablePositions(): Promise<RedeemablePosition[]> {
    console.log("正在扫描链上已结算的 Oracle 和未提取的头寸...");
    const positions: RedeemablePosition[] = [];
    positions.push({
    managerId: "0x926cbf800a051d8d93ac4d1ff9a049116ffd7c3705fe33baf5b45ac981f8b082",
    oracleId: "0x169c5df118f4655fcb6404bd8e1d328f0bf0789855c7511236a48d936b4f01e3",
    marketKey: {
        oracle_id: "0x169c5df118f4655fcb6404bd8e1d328f0bf0789855c7511236a48d936b4f01e3",
        expiry: 1780398900000n,
        strike: 69200n * 1_000_000_000n,
        is_up: true,
    },
    quantity: 10n * 1_000_000n,
    });
    
    // TODO: 1. 查找 is_settled 的 Oracle
    // TODO: 2. 查找持有该 Oracle 对应 MarketKey 的 PredictManager
    // TODO: 3. 过滤出 quantity > 0 的记录
    
    return positions;
}