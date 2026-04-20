/**
 * Token Duel — devnet smoke test.
 *
 * Exercises all three instructions end-to-end against the deployed devnet
 * program. Creates a fresh ephemeral player, funds it via airdrop, stakes,
 * settles with tier-1 (half refund), verifies on-chain balance deltas.
 *
 * Run:
 *   cd scripts
 *   npm install
 *   npm run smoke
 */

import * as anchor from '@coral-xyz/anchor';
import { BN, Program } from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';

// IDL is emitted by `anchor build` at target/idl/token_duel.json.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require('../target/idl/token_duel.json');
const PROGRAM_ID = new PublicKey(idl.address);
const RPC_URL = 'https://api.devnet.solana.com';

function explorer(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function accountExplorer(addr: PublicKey): string {
  return `https://explorer.solana.com/address/${addr.toBase58()}?cluster=devnet`;
}

async function main() {
  // 1. Load admin keypair (solana CLI default location).
  const adminPath = path.join(homedir(), '.config/solana/id.json');
  const adminBytes = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminBytes));

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  anchor.setProvider(provider);
  const program = new Program(idl as any, provider) as any;

  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('Admin:     ', admin.publicKey.toBase58());
  console.log('RPC:       ', RPC_URL);
  console.log('');

  // 2. Pool PDA — derived once from [b"pool"].
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool')],
    PROGRAM_ID
  );
  console.log('Pool PDA:  ', poolPda.toBase58());

  // 3. Initialize pool if uninitialized.
  const poolBalance = await connection.getBalance(poolPda);
  console.log('Pool balance (pre):', poolBalance, 'lamports');
  if (poolBalance < 50_000_000) {
    console.log('Funding pool with 0.1 SOL...');
    const sig = await program.methods
      .initializePool(new BN(100_000_000))
      .accounts({
        admin: admin.publicKey,
        pool: poolPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('  initialize_pool sig:', sig);
    console.log('  explorer:', explorer(sig));
    const poolAfterInit = await connection.getBalance(poolPda);
    console.log('  pool balance (post init):', poolAfterInit, 'lamports');
  } else {
    console.log('Pool already funded, skipping initialize_pool.');
  }
  console.log('');

  // 4. Ephemeral player + airdrop.
  const player = Keypair.generate();
  console.log('Player:    ', player.publicKey.toBase58());

  // Fund player from admin (devnet airdrop is rate-limited; transfer is reliable).
  console.log('Funding player (admin → player, 0.5 SOL)...');
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: player.publicKey,
      lamports: Math.floor(0.5 * LAMPORTS_PER_SOL),
    })
  );
  const fundSig = await sendAndConfirmTransaction(connection, fundTx, [admin], {
    commitment: 'confirmed',
  });
  console.log('  fund sig:', fundSig);
  const playerInitial = await connection.getBalance(player.publicKey);
  console.log('Player balance (post funding):', playerInitial / LAMPORTS_PER_SOL, 'SOL');
  console.log('');

  // 5. commit — stake 0.01 SOL into a new per-session escrow.
  const stake = new BN(10_000_000); // 0.01 SOL
  const sessionSeed = new BN(Date.now() % 1_000_000);

  const [sessionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('session'),
      player.publicKey.toBuffer(),
      sessionSeed.toArrayLike(Buffer, 'le', 8),
    ],
    PROGRAM_ID
  );
  const [escrowPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), sessionPda.toBuffer()],
    PROGRAM_ID
  );
  console.log('Session PDA:', sessionPda.toBase58());
  console.log('Escrow PDA :', escrowPda.toBase58());
  console.log('session_seed:', sessionSeed.toString());

  console.log('\n--- commit(0.01 SOL) ---');
  const commitSig = await program.methods
    .commit(stake, sessionSeed)
    .accounts({
      player: player.publicKey,
      session: sessionPda,
      escrow: escrowPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([player])
    .rpc();
  console.log('commit sig:', commitSig);
  console.log('explorer: ', explorer(commitSig));

  const escrowBalance = await connection.getBalance(escrowPda);
  console.log('Escrow balance:', escrowBalance / LAMPORTS_PER_SOL, 'SOL (expected 0.01)');

  // 6. settle(height=15) — tier 1 (half refund).
  const before = {
    player: await connection.getBalance(player.publicKey),
    pool: await connection.getBalance(poolPda),
    escrow: await connection.getBalance(escrowPda),
  };

  console.log('\n--- settle(height=15, tier=half) ---');
  const settleSig = await program.methods
    .settle(15)
    .accounts({
      player: player.publicKey,
      session: sessionPda,
      escrow: escrowPda,
      pool: poolPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([player])
    .rpc();
  console.log('settle sig:', settleSig);
  console.log('explorer: ', explorer(settleSig));

  const after = {
    player: await connection.getBalance(player.publicKey),
    pool: await connection.getBalance(poolPda),
    escrow: await connection.getBalance(escrowPda),
  };

  const playerDelta = after.player - before.player;
  const poolDelta = after.pool - before.pool;

  console.log('\n--- Results ---');
  console.log('Player delta:', playerDelta, 'lamports');
  console.log('  (expected ≈ +5_000_000 half-refund + rent-refund - tx-fee)');
  console.log('Pool delta:  ', poolDelta, 'lamports');
  console.log('  (expected exactly +5_000_000 = half of 0.01 SOL stake)');
  console.log('Escrow balance:', after.escrow, 'lamports (expected 0 — account drained)');

  console.log('\nProgram account: ', accountExplorer(PROGRAM_ID));
  console.log('Pool account:    ', accountExplorer(poolPda));

  if (poolDelta === 5_000_000) {
    console.log('\n✅ SUCCESS — tier-1 payout math verified on-chain.');
  } else {
    console.log('\n⚠️  pool delta did not match expected 5_000_000 lamports. Check compute_payout logic.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
