/**
 * Base58.ts — Pure TypeScript base58 encoder/decoder.
 * No dependencies. Uses the Bitcoin/Solana alphabet.
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE = ALPHABET.length; // 58

// Build reverse lookup table
const ALPHABET_MAP = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP.set(ALPHABET[i], i);
}

/**
 * Encode a Uint8Array to a base58 string.
 */
export function base58Encode(bytes: Uint8Array): string {
    if (bytes.length === 0) return '';

    // Count leading zeros
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) {
        zeros++;
    }

    // Convert to base58
    const size = Math.ceil(bytes.length * 138 / 100) + 1; // log(256) / log(58) ≈ 1.37
    const b58 = new Uint8Array(size);
    let length = 0;

    for (let i = zeros; i < bytes.length; i++) {
        let carry = bytes[i];
        let j = 0;
        for (let k = size - 1; k >= 0; k--, j++) {
            if (carry === 0 && j >= length) break;
            carry += 256 * b58[k];
            b58[k] = carry % BASE;
            carry = Math.floor(carry / BASE);
        }
        length = j;
    }

    // Skip leading zeros in base58 result
    let start = size - length;
    while (start < size && b58[start] === 0) {
        start++;
    }

    // Build string: leading '1's for zero bytes + base58 digits
    let result = '';
    for (let i = 0; i < zeros; i++) {
        result += ALPHABET[0];
    }
    for (let i = start; i < size; i++) {
        result += ALPHABET[b58[i]];
    }

    return result;
}

/**
 * Decode a base58 string to a Uint8Array.
 * Returns empty Uint8Array on invalid input.
 */
export function base58Decode(str: string): Uint8Array {
    if (str.length === 0) return new Uint8Array(0);

    // Count leading '1's (they map to zero bytes)
    let zeros = 0;
    while (zeros < str.length && str[zeros] === ALPHABET[0]) {
        zeros++;
    }

    // Convert from base58
    const size = Math.ceil(str.length * 733 / 1000) + 1; // log(58) / log(256) ≈ 0.733
    const b256 = new Uint8Array(size);
    let length = 0;

    for (let i = zeros; i < str.length; i++) {
        const value = ALPHABET_MAP.get(str[i]);
        if (value === undefined) {
            // Invalid character — return empty
            return new Uint8Array(0);
        }
        let carry = value;
        let j = 0;
        for (let k = size - 1; k >= 0; k--, j++) {
            if (carry === 0 && j >= length) break;
            carry += BASE * b256[k];
            b256[k] = carry % 256;
            carry = Math.floor(carry / 256);
        }
        length = j;
    }

    // Skip leading zeros in base256 result
    let start = size - length;
    while (start < size && b256[start] === 0) {
        start++;
    }

    // Build result: leading zero bytes + decoded bytes
    const result = new Uint8Array(zeros + (size - start));
    // Leading zeros are already 0 in a new Uint8Array
    for (let i = start; i < size; i++) {
        result[zeros + (i - start)] = b256[i];
    }

    return result;
}

/**
 * Validate that a string is a valid base58 Solana public key.
 * Public keys are 32 bytes, which encode to 32-44 base58 characters.
 */
export function isValidBase58Pubkey(str: string): boolean {
    if (!str || str.length < 32 || str.length > 44) return false;
    for (let i = 0; i < str.length; i++) {
        if (!ALPHABET_MAP.has(str[i])) return false;
    }
    return true;
}
