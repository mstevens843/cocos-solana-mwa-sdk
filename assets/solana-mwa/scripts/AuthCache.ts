/**
 * AuthCache.ts — Persistent auth token cache for MWA session reuse.
 *
 * Port of Unity's AuthCache.cs / Godot's auth_cache.gd.
 * Uses Cocos Creator's sys.localStorage (backed by SQLite on native).
 *
 * Godot Bug Prevention:
 *   - Bug #5: Validates pubkey.length > 20 before storing (no empty pubkey false positives)
 * Unity Bug Prevention:
 *   - Bug U3: Logs auth_token_len on every set() so empty tokens are immediately visible
 */

import { sys } from 'cc';
import { CachedAuth } from './MWATypes';
import { isValidBase58Pubkey } from './Base58';

const TAG = '[AuthCache]';
const CACHE_PREFIX = 'mwa_auth_';
const LATEST_KEY = 'mwa_auth_latest';
const ALL_KEYS_KEY = 'mwa_auth_all_keys';

export class AuthCache {

    constructor() {
        console.log(`${TAG} constructor | START storage_available=${sys.localStorage != null}`);
        const count = this._getAllKeys().length;
        console.log(`${TAG} constructor | DONE existing_entries=${count}`);
    }

    // ─── Get ─────────────────────────────────────────────────────────────

    /**
     * Retrieve cached auth for a specific pubkey.
     * Returns null if not found.
     */
    get(pubkey: string): CachedAuth | null {
        const key = CACHE_PREFIX + pubkey;
        console.log(`${TAG} get | START pubkey=${pubkey} key=${key}`);

        const json = sys.localStorage.getItem(key);
        if (!json) {
            console.log(`${TAG} get | NOT_FOUND`);
            return null;
        }

        try {
            const cached: CachedAuth = JSON.parse(json);
            const ageSeconds = Math.floor(Date.now() / 1000) - (cached.timestamp || 0);
            console.log(`${TAG} get | FOUND pubkey=${cached.pubkey} auth_token_len=${cached.authToken?.length ?? 0} walletPackage=${cached.walletPackage || '(default)'} walletUriBase=${cached.walletUriBase || '(empty)'} timestamp=${cached.timestamp} age_seconds=${ageSeconds}`);
            return cached;
        } catch (e) {
            console.log(`${TAG} get | PARSE_ERROR key=${key} error=${e}`);
            return null;
        }
    }

    /**
     * Retrieve the most recently cached auth (any pubkey).
     * Returns null if no cached auth exists.
     */
    getLatest(): CachedAuth | null {
        console.log(`${TAG} getLatest | START`);

        const latestPubkey = sys.localStorage.getItem(LATEST_KEY);
        if (!latestPubkey) {
            console.log(`${TAG} getLatest | NO_LATEST_KEY`);
            return null;
        }

        console.log(`${TAG} getLatest | latest_pubkey=${latestPubkey}`);
        const result = this.get(latestPubkey);
        console.log(`${TAG} getLatest | DONE found=${result != null} pubkey=${result?.pubkey || '(none)'} walletPackage=${result?.walletPackage || '(none)'}`);
        return result;
    }

    // ─── Set ─────────────────────────────────────────────────────────────

    /**
     * Store an authorization result.
     * Validates pubkey before storing (Bug #5 prevention).
     * Logs auth_token_len for visibility (Bug U3 prevention).
     */
    set(pubkey: string, authToken: string, walletUriBase: string = '', walletPackage: string = ''): void {
        console.log(`${TAG} set | START pubkey=${pubkey} auth_token_len=${authToken?.length ?? 0} wallet_uri_base=${walletUriBase || '(empty)'} wallet_package=${walletPackage || '(default)'}`);

        // Bug #5 prevention: reject empty/invalid pubkeys
        if (!isValidBase58Pubkey(pubkey)) {
            console.log(`${TAG} set | REJECTED invalid pubkey length=${pubkey?.length ?? 0} (must be 32-44 base58 chars)`);
            return;
        }

        // Bug U3 prevention: warn if auth token is empty
        if (!authToken || authToken.length === 0) {
            console.log(`${TAG} set | WARN auth_token is empty — reauthorization may not work`);
        }

        const cached: CachedAuth = {
            pubkey,
            authToken: authToken || '',
            walletUriBase: walletUriBase || '',
            walletPackage: walletPackage || '',
            timestamp: Math.floor(Date.now() / 1000),
        };

        const json = JSON.stringify(cached);
        sys.localStorage.setItem(CACHE_PREFIX + pubkey, json);
        sys.localStorage.setItem(LATEST_KEY, pubkey);

        // Track all known pubkeys for clearAll
        const allKeys = this._getAllKeys();
        const isNew = !allKeys.includes(pubkey);
        if (isNew) {
            allKeys.push(pubkey);
            this._saveAllKeys(allKeys);
        }

        console.log(`${TAG} set | DONE pubkey=${pubkey} auth_token_len=${cached.authToken.length} walletPackage=${cached.walletPackage || '(default)'} timestamp=${cached.timestamp} json_len=${json.length} is_new_entry=${isNew} total_cached=${allKeys.length}`);
    }

    // ─── Clear ───────────────────────────────────────────────────────────

    /**
     * Remove cached auth for a specific pubkey.
     */
    clear(pubkey: string): void {
        const key = CACHE_PREFIX + pubkey;
        const existed = sys.localStorage.getItem(key) != null;
        console.log(`${TAG} clear | START pubkey=${pubkey} existed=${existed}`);

        sys.localStorage.removeItem(key);

        // If this was the latest, clear that too
        const latestPubkey = sys.localStorage.getItem(LATEST_KEY);
        if (latestPubkey === pubkey) {
            sys.localStorage.removeItem(LATEST_KEY);
            console.log(`${TAG} clear | cleared latest_key (was this pubkey)`);
        }

        // Remove from tracked keys
        const allKeys = this._getAllKeys();
        const idx = allKeys.indexOf(pubkey);
        if (idx >= 0) {
            allKeys.splice(idx, 1);
            this._saveAllKeys(allKeys);
        }

        console.log(`${TAG} clear | DONE remaining=${allKeys.length}`);
    }

    /**
     * Clear ALL cached authorizations.
     */
    clearAll(): void {
        const allKeys = this._getAllKeys();
        console.log(`${TAG} clearAll | START count=${allKeys.length}`);

        for (const pubkey of allKeys) {
            console.log(`${TAG} clearAll | removing pubkey=${pubkey} key=${CACHE_PREFIX}${pubkey}`);
            sys.localStorage.removeItem(CACHE_PREFIX + pubkey);
        }

        sys.localStorage.removeItem(LATEST_KEY);
        sys.localStorage.removeItem(ALL_KEYS_KEY);

        console.log(`${TAG} clearAll | DONE removed_count=${allKeys.length} keys_removed=[${allKeys.join(',')}]`);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    /**
     * Check if any cached auth exists.
     */
    hasCachedAuth(): boolean {
        const latest = sys.localStorage.getItem(LATEST_KEY);
        const has = latest != null && latest.length > 0;
        console.log(`${TAG} hasCachedAuth | result=${has} latest_key=${latest || '(none)'}`);
        return has;
    }

    private _getAllKeys(): string[] {
        const raw = sys.localStorage.getItem(ALL_KEYS_KEY);
        if (!raw || raw.length === 0) return [];
        return raw.split(',').filter(k => k.length > 0);
    }

    private _saveAllKeys(keys: string[]): void {
        sys.localStorage.setItem(ALL_KEYS_KEY, keys.join(','));
    }
}
