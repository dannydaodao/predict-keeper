// /home/caijun/predict-keeper/src/index.ts
import { getClient, getSigner } from './utils';
import { CONFIG } from './config';
import { findRedeemablePositions, findSingleOraclePositions } from './scanner';
import { executeRedeemBatch, refreshGasCoinCache } from './executor';

async function main() {
    console.log(`🤖 Predict Keeper [极速版] 已启动！`);
    console.log(`📡 WebSocket 实时监听中...`);
    
    const signer = getSigner();
    const client = getClient(CONFIG.NETWORK);
    console.log(`💼 Keeper 地址: ${signer.toSuiAddress()}`);
    console.log(`-----------------------------------`);

    // 1. 启动时先全量扫一次，把历史上积压的漏网之鱼代领掉
    try {
        // const pending = await findRedeemablePositions();
        // await executeRedeemBatch(pending);
    } catch (e) {
        console.error("初始化扫描失败:", e);
    }

    await refreshGasCoinCache();

    // 2. 【核心提速】直接使用底层 WebSocket 订阅 OracleSettled 事件，实现真正的毫秒级响应
    const settledEventType = `${CONFIG.PREDICT_PACKAGE_ID}::oracle::OracleSettled`;
    
    // 获取 Websocket 端点
    const rpcUrl = process.env.RPC_URL || "https://rpc-testnet.suiscan.xyz";
    let wsUrl = rpcUrl.replace(/^http/, 'ws');
    if (!wsUrl.endsWith('/websocket') && !wsUrl.includes(':9000')) {
        // 如果是 https://rpc-testnet.suiscan.xyz 类似的普通 HTTP，后缀加上 /websocket
        wsUrl = wsUrl.replace(/\/+$/, '') + '/websocket';
    }

    console.log(`⚡ 正在向 Sui 全节点建立 Websocket 连接: ${wsUrl}`);
    
    function startEventSubscription() {
        // Bun 和现代 Node.js 均支持原生 WebSocket。
        // 如果在特定 Node.js 环境下报错，可运行 `cd predict-keeper && bun add ws`，然后在这里引入 `import WebSocket from 'ws';`
        const ws = new WebSocket(wsUrl);

        let pingInterval: any;

        ws.onopen = () => {
            console.log(`✅ WebSocket 连接已建立，正在发送 suix_subscribeEvent 订阅请求...`);
            
            const subscribePayload = {
                jsonrpc: "2.0",
                id: Date.now(),
                method: "suix_subscribeEvent",
                params: [
                    { MoveEventType: settledEventType }
                ]
            };
            ws.send(JSON.stringify(subscribePayload));

            // 每 20 秒发送一次 ping 保持连接活跃，防止节点超时断开
            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "ping", params: [], id: 999 }));
                }
            }, 20000);
        };

        ws.onmessage = async (messageEvent) => {
            try {
                const data = JSON.parse(messageEvent.data as string);
                
                // 忽略 ping 返回或其他不相关消息
                if (data.result !== undefined && typeof data.result === 'number') {
                    console.log(`📡 订阅注册成功！Subscription ID: ${data.result}`);
                    return;
                }

                // 处理推送的事件
                if (data.method === "suix_subscribeEvent" && data.params) {
                    const event = data.params.result;
                    const json = event.parsedJson as any;
                    
                    console.log(`\n🚨 [实时爆料 - Websocket 毫秒级推送] 检测到 Oracle 刚刚结算！`);
                    console.log(`   Oracle ID: ${json.oracle_id}`);
                    console.log(`   结算价格:   ${json.settlement_price}`);
                    console.log(`   触发交易:   ${event.id.txDigest}`);
                    console.log(`   eventtime:   ${json.timestamp}`);
                    console.log(`   事件时间:   ${new Date().toLocaleString()}`);
                    
                    // 收到结算通知，【立刻】进行精准代领，不耽误一毫秒！
                    console.time("⏱️ 扫描到执行耗时");
                    const positions = await findSingleOraclePositions({
                        id: json.oracle_id,
                        price: BigInt(json.settlement_price),
                    });
                    console.log(`handle position time ${new Date().toLocaleString()}`);
                    await executeRedeemBatch(positions);
                    console.timeEnd("⏱️ 扫描到执行耗时");
                }
            } catch (err) {
                console.error("解析 WebSocket 推送消息失败:", err);
            }
        };

        ws.onerror = (errorEvent: any) => {
            console.error("❌ WebSocket 发生错误:", errorEvent.message || errorEvent);
        };

        ws.onclose = (closeEvent) => {
            console.warn(`⚠️ WebSocket 连接断开 (Code: ${closeEvent.code})。正在尝试在 1 秒后重连...`);
            clearInterval(pingInterval);
            
            // 毫秒级重连机制，确保机器人不间断在线
            setTimeout(() => {
                startEventSubscription();
            }, 1000);
        };
    }

    // 启动极速实时监听
    try {
        startEventSubscription();
    } catch (err) {
        console.error("❌ 启动 Websocket 订阅失败:", err);
    }

    // 保持进程存活
    await new Promise(() => {});
}

export async function initGasCoinFromEnv(): Promise<GasCoinRef | null> {
    const gasObjectId = process.env.GAS_OBJECT;
    if (!gasObjectId) return null;

    try {
        console.log(`📡 正在根据环境变量配置的 GAS_OBJECT [${gasObjectId}] 进行初始化...`);
        const objResponse = await client.getObject({
            id: gasObjectId
        });

        if (objResponse.data) {
            cachedGasCoin = {
                objectId: objResponse.data.objectId,
                version: objResponse.data.version,
                digest: objResponse.data.digest,
            };
            console.log(`✅ 成功初始化指定的 GAS_OBJECT 缓存！`);
            return cachedGasCoin;
        }
    } catch (e) {
        console.error("❌ 指定的 GAS_OBJECT 初始化失败:", e);
    }
    return null;
}

main();