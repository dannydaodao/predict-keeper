# predict-keeper

Predict Keeper is an essential decentralized infrastructure bot built for the DeepBook V3 Predict market on Sui. In the Predict protocol, users must manually claim their winnings after an oracle settles, which often leads to trapped liquidity and a poor user experience.

This keeper runs a highly optimized off-chain scanner to detect settled OracleSVI instances and unredeemed PredictManager positions. It then batches and executes redeem_permissionless transactions via Programmable Transaction Blocks (PTBs), automatically delivering payouts directly to users' accounts. By doing so, Predict Keeper dramatically improves capital velocity and provides a seamless "auto-settlement" experience for the entire ecosystem.

To install dependencies:

```bash
bun install
```

To run debug demo:

```bash
bun run dev
```

to run keeper:

```bash
bun run keeper
```


This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
