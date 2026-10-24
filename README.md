# TrueTonne

**Is every claimed tonne real?** Paste a company's carbon-offset claim. TrueTonne checks each claimed tonne against public registry retirements, shows which retirements back it, and records the result on-chain so the same tonne cannot back two claims.

Live: https://truetonne.ibnweb3lab.workers.dev · Contract (Base Sepolia): [`0x9436A63fb5f3c04225303F528D1D54802A455572`](https://sepolia.basescan.org/address/0x9436A63fb5f3c04225303F528D1D54802A455572)

Built for the IEEE ClimateChain Global Hackathon, **carbon markets** track (blockchain + AI).

## In 30 seconds
1. **Read.** An AI model (Llama 3.3 70B on Cloudflare Workers AI) pulls claims out of pasted text. It only extracts: any project ID, name, tonnage or year not literally in your text is dropped and shown to you.
2. **Match.** Each claim is matched against 495,403 retirements (CarbonPlan OffsetsDB snapshot, 1 June 2026) by project, vintage, retirement year and the named claimant. A retired tonne can back one claim per report.
3. **Prove.** Reports are canonical JSON with a SHA-256 hash you can re-compute in your browser.
4. **Record.** `TonneLedger.sol` keeps a per-retirement-row cap. The first claimant to record a row holds it; a later claimant is refused and the contract emits `DoubleClaimBlocked`.

Demo pair from real data: Kinaxis vs ClimeCo on CAR1335 (5,000 t retired by ClimeCo on behalf of Kinaxis). Record Kinaxis, then ClimeCo is refused.

## Honest limits
Checks paperwork, not project quality. The open data has **no serial numbers**, so matching is by project + vintage + year + name. The snapshot ends 1 June 2026 because CarbonPlan paused updates ([offsets-db-data#174](https://github.com/carbonplan/offsets-db-data/issues/174)). The contract is on a testnet. Full detail on the site's Method page (`public/docs.html`).

## Stack
Cloudflare Workers + static assets, D1 (SQLite FTS5), Workers AI, Solidity 0.8.30 (Foundry), viem, plain JS front end.

## Run it
```bash
npm install
# data: download the OffsetsDB snapshot into data-raw/, then
python scripts/build-db.py
bash scripts/load-db.sh --local
cp .dev.vars.example .dev.vars   # LEDGER_ADDRESS, ATTESTER_KEY (test key only)
npx wrangler dev                 # AI binding needs a Cloudflare login
npm test
cd contracts && forge test
```

## Layout
`src/` Worker (check engine, AI extraction vetting, hashing, chain) · `public/` pages · `contracts/` TonneLedger + tests · `scripts/` data build and load · `test/` unit tests.

## Data
CarbonPlan OffsetsDB (no copyright claimed by CarbonPlan; the registries may claim rights in their own records). Retirement notes are shown only when they name the claimant typed in.
