#!/usr/bin/env bash
# setup-devnet-skr.sh — provision the devnet test-$SKR mint for the
# betting-duel hackathon build.
#
# Run ONCE from the team treasury keypair. Outputs:
#   1. A new SPL mint pubkey (6 decimals)
#   2. The treasury's ATA holding the initial mint supply
#   3. Funding amount each smoke-test wallet receives
#
# After running:
#   - Paste the `MINT=` line printed at the end into:
#       programs/token-duel/src/state.rs::SKR_MINT_DEVNET (pubkey!(...) macro)
#       assets/token-duel/scripts/WagerCurrency.ts::SKR_MINT_DEVNET
#   - `anchor build && anchor deploy --provider.cluster devnet`
#   - Update `reference_deployments` memory with the new mint pubkey.

set -euo pipefail

CLUSTER="${CLUSTER:-https://api.devnet.solana.com}"
# Defaults to the standard Solana CLI keypair (same one Anchor.toml references).
# Override with TREASURY_KP=/path/to/other.json if you keep a dedicated key.
TREASURY_KP="${TREASURY_KP:-$HOME/.config/solana/id.json}"
INITIAL_SUPPLY="${INITIAL_SUPPLY:-100000000}"   # 100M test-SKR (6-dec atoms = 1e14)
FUND_PER_WALLET="${FUND_PER_WALLET:-1000000}"   # 1M test-SKR per smoke wallet

# Smoke-test wallets — paste your devnet test-wallet pubkeys here. Empty by
# default so the script doesn't accidentally airdrop to strangers.
SMOKE_WALLETS=(
    # "AaaaAlicePubkey..."
    # "BbbbBobPubkey..."
)

if [[ ! -f "$TREASURY_KP" ]]; then
    echo "ERROR: treasury keypair not found at $TREASURY_KP"
    echo "       Override with TREASURY_KP=/path/to/keypair.json"
    exit 1
fi

solana config set --url "$CLUSTER" >/dev/null
echo "[1/4] Creating mint (decimals=6) from $TREASURY_KP..."
# spl-token-cli's `--output json` shape changed between 3.x and 5.x; parse
# the plain text instead (the "Address:  <pubkey>" line is stable across
# versions). Mint authority defaults to the fee-payer keypair, which is
# what we want — same wallet runs `mint` + `transfer` below.
MINT_OUTPUT=$(spl-token create-token --decimals 6 --fee-payer "$TREASURY_KP" --mint-authority "$TREASURY_KP")
echo "$MINT_OUTPUT"
NEW_SKR_MINT=$(echo "$MINT_OUTPUT" | awk '/^Address:/ {print $2; exit}')
if [[ -z "$NEW_SKR_MINT" ]]; then
    echo "ERROR: failed to parse mint address from spl-token output above"
    exit 1
fi
echo "       mint = $NEW_SKR_MINT"

echo "[2/4] Creating treasury ATA + minting $INITIAL_SUPPLY SKR..."
spl-token create-account "$NEW_SKR_MINT" --fee-payer "$TREASURY_KP" >/dev/null || true
spl-token mint "$NEW_SKR_MINT" "$INITIAL_SUPPLY" --fee-payer "$TREASURY_KP" >/dev/null
echo "       minted $INITIAL_SUPPLY SKR to treasury ATA"

echo "[3/4] Funding smoke wallets..."
if (( ${#SMOKE_WALLETS[@]} == 0 )); then
    echo "       (no SMOKE_WALLETS configured — edit this script to add some)"
else
    for wallet in "${SMOKE_WALLETS[@]}"; do
        spl-token transfer "$NEW_SKR_MINT" "$FUND_PER_WALLET" "$wallet" \
            --fee-payer "$TREASURY_KP" --fund-recipient >/dev/null
        echo "       sent $FUND_PER_WALLET SKR → $wallet"
    done
fi

echo "[4/4] DONE. Paste the line below into state.rs + WagerCurrency.ts:"
echo
echo "    MINT=$NEW_SKR_MINT"
echo
