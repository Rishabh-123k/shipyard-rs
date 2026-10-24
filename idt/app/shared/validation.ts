export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isAddressOn(chain: string | null, address: string): boolean {
  return (chain === "solana" ? SOLANA_ADDRESS : EVM_ADDRESS).test(address);
}
export const POSITIVE_DECIMAL = /^(?=.*[1-9])\d+(\.\d+)?$/;
export const HEX_SCALAR = /^[0-9a-f]{64}$/i;
