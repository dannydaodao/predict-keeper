// /home/caijun/predict-keeper/src/index.ts
import { getClient, getSigner } from './utils';
import { CONFIG } from './config';
import { findRedeemablePositions, findSingleOraclePositions } from './scanner';
import { executeRedeemBatch, refreshGasCoinCache } from './executor';

async function main() {
    console.log(`🤖 Predict Keeper [Ultra-Fast] Started!`);
    console.log(`📡 WebSocket Real-time Listening...`);
    
    const signer = getSigner();
    const client = getClient(CONFIG.NETWORK);
    console.log(`💼 Keeper Address: ${signer.toSuiAddress()}`);
    console.log(`-----------------------------------`);

    // 1. Full scan on startup to redeem historical missed positions
    try {
        // const pending = await findRedeemablePositions();
        // await executeRedeemBatch(pending);
    } catch (e) {
        console.error("Initial scan failed:", e);
    }

    await refreshGasCoinCache();

    // 2. [Core Speedup] Use low-level WebSocket to subscribe to OracleSettled events for real millisecond response
    const settledEventType = `${CONFIG.PREDICT_PACKAGE_ID}::oracle::OracleSettled`;
    
    // Get WebSocket endpoint
    const rpcUrl = process.env.RPC_URL || "https://rpc-testnet.suiscan.xyz";
    let wsUrl = rpcUrl.replace(/^http/, 'ws');
    if (!wsUrl.endsWith('/websocket') && !wsUrl.includes(':9000')) {
        // If it is ordinary HTTP, append /websocket
        wsUrl = wsUrl.replace(/\/+$/, '') + '/websocket';
    }

    console.log(`⚡ Establishing WebSocket connection to Sui full node: ${wsUrl}`);
    
    function startEventSubscription() {
        // Native WebSocket is supported in Bun and modern Node.js.
        // If it throws error in specific Node.js environment, run `cd predict-keeper && bun add ws` and import WebSocket.
        const ws = new WebSocket(wsUrl);

        let pingInterval: any;

        ws.onopen = () => {
            console.log(`✅ WebSocket connection established, sending suix_subscribeEvent subscription request...`);
            
            const subscribePayload = {
                jsonrpc: "2.0",
                id: Date.now(),
                method: "suix_subscribeEvent",
                params: [
                    { MoveEventType: settledEventType }
                ]
            };
            ws.send(JSON.stringify(subscribePayload));

            // Send ping every 20 seconds to keep connection alive
            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "ping", params: [], id: 999 }));
                }
            }, 20000);
        };

        ws.onmessage = async (messageEvent) => {
            try {
                const data = JSON.parse(messageEvent.data as string);
                
                // Ignore ping responses or other irrelevant messages
                if (data.result !== undefined && typeof data.result === 'number') {
                    console.log(`📡 Subscription registered successfully! Subscription ID: ${data.result}`);
                    return;
                }

                // Handle pushed events
                if (data.method === "suix_subscribeEvent" && data.params) {
                    const event = data.params.result;
                    const json = event.parsedJson as any;
                    
                    console.log(`\n🚨 [Real-time Push - WebSocket Millisecond Level] Detected Oracle just settled!`);
                    console.log(`   Oracle ID: ${json.oracle_id}`);
                    console.log(`   Settlement Price:   ${json.settlement_price}`);
                    console.log(`   Triggering TX:   ${event.id.txDigest}`);
                    console.log(`   eventtime:   ${json.timestamp}`);
                    console.log(`   Event Time:   ${new Date().toLocaleString()}`);
                    
                    // Received settlement notice, redeem immediately without delay!
                    console.time("⏱️ Scan-to-execution cost");
                    const positions = await findSingleOraclePositions({
                        id: json.oracle_id,
                        price: BigInt(json.settlement_price),
                    });
                    console.log(`handle position time ${new Date().toLocaleString()}`);
                    await executeRedeemBatch(positions);
                    console.timeEnd("⏱️ Scan-to-execution cost");
                }
            } catch (err) {
                console.error("Failed to parse WebSocket pushed message:", err);
            }
        };

        ws.onerror = (errorEvent: any) => {
            console.error("❌ WebSocket error occurred:", errorEvent.message || errorEvent);
        };

        ws.onclose = (closeEvent) => {
            console.warn(`⚠️ WebSocket disconnected (Code: ${closeEvent.code}). Retrying in 1s...`);
            clearInterval(pingInterval);
            
            // Millisecond level reconnection mechanism to ensure 24/7 online
            setTimeout(() => {
                startEventSubscription();
            }, 1000);
        };
    }

    // Start ultra-fast real-time listening
    try {
        startEventSubscription();
    } catch (err) {
        console.error("❌ Failed to start WebSocket subscription:", err);
    }

    // Keep process alive
    await new Promise(() => {});
}

export async function initGasCoinFromEnv(): Promise<GasCoinRef | null> {
    const gasObjectId = process.env.GAS_OBJECT;
    if (!gasObjectId) return null;

    try {
        console.log(`📡 Initializing with GAS_OBJECT [${gasObjectId}] from env...`);
        const objResponse = await client.getObject({
            id: gasObjectId
        });

        if (objResponse.data) {
            cachedGasCoin = {
                objectId: objResponse.data.objectId,
                version: objResponse.data.version,
                digest: objResponse.data.digest,
            };
            console.log(`✅ Successfully initialized specified GAS_OBJECT cache!`);
            return cachedGasCoin;
        }
    } catch (e) {
        console.error("❌ Initialization of specified GAS_OBJECT failed:", e);
    }
    return null;
}

main();