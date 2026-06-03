import { getSigner } from './utils';
import { CONFIG } from './config';
import { findRedeemablePositions } from './scanner';
import { executeRedeemBatch } from './executor';

async function main() {
    console.log(`🤖 Predict Keeper 机器人已启动！`);
    console.log(`📡 网络: ${CONFIG.NETWORK}`);
    
    // 启动时初始化 Signer 并打印地址
    const signer = getSigner();
    const keeperAddress = signer.toSuiAddress();
    console.log(`💼 Keeper 地址: ${keeperAddress}`);
    console.log(`-----------------------------------`);

    // 机器人死循环
    while (true) {
        try {
            // 1. 扫描猎物
            const positions = await findRedeemablePositions();
            
            if (positions.length > 0) {
                // 2. 咬住猎物并上链
                await executeRedeemBatch(positions);
            } else {
                console.log(`[${new Date().toLocaleTimeString()}] 暂无需要代领的头寸，继续等待...`);
            }
        } catch (error) {
            console.error("主循环发生错误，稍后重试...", error);
        }

        // 3. 休息一段时间再查
        await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
    }
}

// 启动！
main();