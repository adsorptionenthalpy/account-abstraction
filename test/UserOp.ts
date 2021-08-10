import {arrayify, defaultAbiCoder, keccak256} from "ethers/lib/utils";
import {BigNumberish, Contract, Signer, Wallet} from "ethers";
import {AddressZero} from "./testutils";
import {BytesLike} from "@ethersproject/bytes";
import {ecsign, toRpcSig, keccak256 as keccak256_buffer} from "ethereumjs-util";
import {waffle} from "hardhat";
import {Singleton} from '../typechain'
import assert from "assert";
//define the same types as used by typechain/ethers
type address = string
type uint256 = BigNumberish
type uint = BigNumberish
type uint64 = BigNumberish
type bytes = BytesLike

export interface UserOperation {
  target: address
  nonce: uint256
  initCode: bytes
  callData: bytes
  callGas: uint64

  maxFeePerGas: uint
  maxPriorityFeePerGas: uint
  paymaster: address

  signer: address
  signature: bytes
}

export function packUserOp(op: UserOperation): string {
  return defaultAbiCoder.encode([
    'address', // target
    'uint256', // nonce
    'bytes', // callData
    'uint64', // callGas
    'uint', // maxFeePerGas
    'uint', // maxPriorityFeePerGas
    'address', // paymaster
  ], [
    op.target,
    op.nonce,
    op.callData,
    op.callGas,
    op.maxFeePerGas,
    op.maxPriorityFeePerGas,
    op.paymaster
  ])
}

export const ZeroUserOp: UserOperation = {
  target: AddressZero,
  nonce: 0,
  initCode: '0x',
  callData: '0x',
  callGas: 0,
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 3,
  paymaster: AddressZero,
  signer: AddressZero,
  signature: '0x'
}

export function signUserOp(op: UserOperation, signer: Wallet): UserOperation {
  let packed = packUserOp(op);
  let message = Buffer.from(arrayify(keccak256(packed)));
  let msg1 = Buffer.concat([
    Buffer.from("\x19Ethereum Signed Message:\n32", 'ascii'),
    message
  ])

  const sig = ecsign(keccak256_buffer(msg1), Buffer.from(arrayify(signer.privateKey)))
  // that's equivalent of:  await signer.signMessage(message);
  // (but without "async"
  let signedMessage1 = toRpcSig(sig.v, sig.r, sig.s);
  return {
    ...op,
    signer: signer.address,
    signature: signedMessage1
  }
}

export function fillUserOp(op: Partial<UserOperation>, defaults = ZeroUserOp): UserOperation {
  const filled = {...defaults, ...op}
  return filled
}

//singleton param is only required to fill in "target address when specifying "initCode"
export async function fillAndSign(op: Partial<UserOperation>, signer: Wallet, singleton?: Singleton): Promise<UserOperation> {
  let op1 = {...op}
  let provider = signer.provider;
  if (op.initCode != null) {
    op1.nonce = 0
    if (op1.target == null) {
      assert(singleton != null, 'must have singleton when using initCode')
      op1.target = await singleton!.getAccountAddress(op.initCode, op1.nonce)
    }
  }
  if (op1.nonce == null) {
    const c = new Contract(op.target!, ['function nonce() view returns(address)'], provider)
    op1.nonce = await c.nonce()
  }
  if (op1.callGas == null) {
    const gasEtimated = await provider.estimateGas({from: signer.address, to: op1.target, data: op1.callData})
    //estimateGas assumes direct call from owner. add wrapper cost.
    op1.callGas = gasEtimated.add(55000)
  }
  if (op1.maxFeePerGas == null) {
    op1.maxFeePerGas = await provider.getGasPrice()
  }
  if (op1.maxPriorityFeePerGas == null) {
    let block = await provider.getBlock('latest');
    op1.maxPriorityFeePerGas = block.baseFeePerGas ?? op1.maxFeePerGas
  }
  let op2 = fillUserOp(op1);
  return signUserOp(op2, signer)
}
