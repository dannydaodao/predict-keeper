export const CONFIG = {
    NETWORK: 'testnet' as const,
    PREDICT_PACKAGE_ID: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
    PREDICT_OBJECT_ID: '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
    DUSDC_TYPE: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
    CLOCK_ID: '0x6',
    SERVER_URL: 'https://predict-server.testnet.mystenlabs.com',
    
    // Keeper 轮询的间隔时间 (毫秒)
    POLL_INTERVAL_MS: 15 * 1000, 
};

export const predictPackageID = { mainnet: "", testnet: "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138" };
export const predictRegistryID = { mainnet: "", testnet: "0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64" };
export const predictAdminCapID = { mainnet: "", testnet: "0x9faa4d2c0f4aaf7c9a50d3278490ffdf31f9ca1ffd1c41063578dcf3e29c2a6b" };
export const predictUpgradeCapID = { mainnet: "", testnet: "0x70d7658401a4454c71891780f2763ddd267257c39bf951f1017587fd8842ca51" };
export const predictObjectID = { mainnet: "", testnet: "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a" };
export const predictOracleCapID = { mainnet: "", testnet: "" };
export const predictOracleCapIDs: Record<string, string[]> = { mainnet: [], testnet: [] };
export const predictOracleID = { mainnet: "", testnet: "" };

// DUSDC test token
export const dusdcPackageID = { mainnet: "", testnet: "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a" };
export const dusdcTreasuryCapID = { mainnet: "", testnet: "0x64f8a47a0af0a3b14db3a7ce89aa206ff77a9c6b5ac0eaef6db2ea46da3ced94" };
export const dusdcCurrencyID = { mainnet: "", testnet: "0xf3000dff421833d4bb8ed58fac146d691a3aaba2785aa1989af65a7089ca3e9c" };

// PLP treasury cap (minted at publish time by plp::init, captured by redeploy)
export const plpTreasuryCapID = { mainnet: "", testnet: "0x2f216dd491208da7a36d6ff435bb969584758c142374e26b087098cdc1dc1de3" };
export const POLL_INTERVAL_MS = 15 * 1000; // Keeper 轮询的间隔时间 (毫秒)
