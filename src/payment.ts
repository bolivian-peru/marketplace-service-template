/**
 * x402 Payment Verification
 * ─────────────────────────
 * DON'T EDIT THIS FILE. It contains critical code for handling payments.
 *
 * This file is responsible for verifying transactions on both Ethereum and Solana networks.
 */

// Import necessary libraries
import { ethers } from 'ethers';
import { Buffer } from 'buffer';

/**
 * Verifies a transaction on the Ethereum network.
 * @param txHash - The hash of the transaction to verify.
 * @param expectedRecipient - The expected recipient address.
 * @param expectedAmount - The expected amount in wei.
 * @returns A Promise that resolves with the verification result.
 */
async function verifyEthereumTransaction(txHash: string, expectedRecipient: string, expectedAmount: number): Promise<boolean> {
  // Initialize Ethereum provider
  const provider = new ethers.providers.JsonRpcProvider('https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID');

  try {
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error('Transaction not found or not confirmed');
    }

    // Check if transaction was successful
    if (receipt.status !== '0x1') {
      return false;
    }

    // Look for ERC-20 Transfer event from USDC contract
    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    for (const log of receipt.logs || []) {
      if (
        log.address?.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' && // USDC contract address
        log.topics?.[0] === transferTopic
      ) {
        const to = '0x' + log.topics[2]?.slice(26);
        const amount = parseInt(log.data, 16) / 10 ** 6; // USDC has 6 decimal places

        if (
          to.toLowerCase() === expectedRecipient.toLowerCase() &&
          amount >= expectedAmount
        ) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Error verifying Ethereum transaction:', error);
    return false;
  }
}

/**
 * Verifies a transaction on the Solana network.
 * @param txHash - The hash of the transaction to verify.
 * @param expectedRecipient - The expected recipient address.
 * @param expectedAmount - The expected amount in lamports (1 SOL = 1 billion lamports).
 * @returns A Promise that resolves with the verification result.
 */
async function verifySolanaTransaction(txHash: string, expectedRecipient: string, expectedAmount: number): Promise<boolean> {
  // Initialize Solana provider
  const connection = new ethers.providers.JsonRpcProvider('https://api.mainnet-beta.solana.com');

  try {
    // Get transaction details
    const tx = await connection.getTransaction(txHash);
    if (!tx) {
      throw new Error('Transaction not found or not confirmed');
    }

    // Check each instruction in the transaction
    for (const inst of tx.transaction.message.instructions) {
      const data = Buffer.from(inst.data, 'base64');

      if (
        inst.programId.toString() === 'TokenkegQd85sXm2xWqoP96Tc3oF1DTPGHL7nRvZJp3wTs' && // Token program ID
        data[0] === 15 && // Transfer instruction index
        Buffer.from(data.slice(1, 33)).toString('hex') === expectedRecipient.toLowerCase().replace(/^0x/, '') &&
        Buffer.from(data.slice(97, 129)).readUInt32LE() >= expectedAmount
      ) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error verifying Solana transaction:', error);
    return false;
  }
}

// Export functions for use in other parts of the application
export { verifyEthereumTransaction, verifySolanaTransaction };