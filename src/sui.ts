// import { SuiClient, getFullnodeUrl } from '@mysten/sui';
// import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
// import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
// import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
// import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
// import { CONFIG } from './config';

// export const client = new SuiClient({ url: getFullnodeUrl(CONFIG.NETWORK) });

// export function getSigner() {
//     const privKey = process.env.PRIVATE_KEY;
//     if (!privKey) {
//         throw new Error("请在 .env 文件中配置 PRIVATE_KEY");
//     }
    
//     const { schema, secretKey } = decodeSuiPrivateKey(privKey);
//     if (schema === undefined || schema === 'ED25519') return Ed25519Keypair.fromSecretKey(secretKey);
//     if (schema === 'Secp256k1') return Secp256k1Keypair.fromSecretKey(secretKey);
//     if (schema === 'Secp256r1') return Secp256r1Keypair.fromSecretKey(secretKey);
    
//     throw new Error(`Keypair scheme not supported: ${schema}`);
// }

// let _signer: any = null;
// export function getKeeperSigner() {
//     if (!_signer) {
//         _signer = getSigner();
//     }
//     return _signer;
// }