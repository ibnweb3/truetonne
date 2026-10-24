# TrueTonne

**Does the carbon-offset claim add up?** Compare a company's claim with public retirement records. TrueTonne shows which records name the company, how many tonnes they cover, and what the available evidence cannot establish.

Live: https://truetonne.ibnweb3lab.workers.dev · Contract (Base Sepolia): [`0x9436A63fb5f3c04225303F528D1D54802A455572`](https://sepolia.basescan.org/address/0x9436A63fb5f3c04225303F528D1D54802A455572)

Built for the IEEE ClimateChain Global Hackathon, **carbon markets** track (blockchain + AI).

## In 30 seconds
1. **Review.** Enter details directly or use Llama 3.3 on Cloudflare Workers AI to extract them from a public statement. Unsupported values are discarded. Review the suggestions against the source before running a check.
2. **Compare.** Each claim is matched against 495,403 retirements (CarbonPlan OffsetsDB snapshot, 1 June 2026) by project, vintage, retirement year and the named claimant. A retired tonne is allocated once within each report. Ambiguous project names require an exact project ID.
3. **Prove.** Reports are canonical JSON with a SHA-256 hash you can re-compute in your browser.
4. **Optionally record.** `TonneLedger.sol` on Base Sepolia keeps a per-retirement-row cap for allocations recorded within TrueTonne's testnet ledger. It blocks allocations that would exceed that cap, including competing claims. It does not certify ownership, update registries or prevent claims elsewhere. Pending, confirmed and failed transactions are shown separately.

The form includes two examples verified against the snapshot: Spotify, 95,000 t from CAR1480 (2021 vintage, retired in 2022); and Kinaxis, 5,000 t from CAR1335 (2025 vintage, retired in 2025). These are registry inputs, not quoted company claims. The Kinaxis example names the company in a retirement note and ClimeCo as the retiring account.

## Honest limits
Checks paperwork, not project quality, ownership or carbon neutrality. A company can appear as an intermediary acting for a client. The open data has **no serial numbers**, so matching is by project + vintage + year + name. The snapshot ends 1 June 2026; CarbonPlan has [documented the pause in updates](https://github.com/carbonplan/offsets-db-data/issues/174). Searches use up to 5,000 records per name variant, report pages show up to 60 evidence rows per claim, and testnet transactions cover up to 80 allocated rows. The downloadable JSON includes the full allocation. Full detail is on the site's Method page (`public/docs.html`).

Saved reports include the entered claims and any source text supplied. Anyone with the report link can read and download them. Use public information only. Company lookups do not save a report.

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

The JavaScript suite covers matching and allocation, malformed requests, recovery states, report integrity and page interactions. In environments that prohibit child processes, run `node --test --test-isolation=none test/*.test.js`. Page logic tests do not replace visual browser verification. After editing the shared report shell or secondary-page templates, regenerate those pages with `python scripts/make-pages.py`.

## Layout
`src/` Worker (check engine, AI extraction vetting, hashing, chain) · `public/` pages · `contracts/` TonneLedger + tests · `scripts/` data build and load · `test/` unit tests.

## Data
CarbonPlan OffsetsDB (no copyright claimed by CarbonPlan; the registries may claim rights in their own records). Retirement notes are shown only when they name the claimant typed in.
