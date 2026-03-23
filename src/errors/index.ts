export enum ErrorCode {
  RpcError = "rpc_error",
  InsufficientFunds = "insufficient_funds",
  AmountTooLow = "amount_too_low",
  TokenNotAccepted = "token_not_accepted",
  TransactionFailed = "transaction_failed",
  DuplicateTransaction = "duplicate_transaction",
  InvalidReceipt = "invalid_receipt",
  InternalError = "internal_error",
  TransactionNotFound = "transaction_not_found",
  WrongContract = "wrong_contract",
  OrderMismatch = "order_mismatch",
  MissingReceipt = "missing_receipt",
}

export class PayNodeException extends Error {
  constructor(public message: string, public code: ErrorCode, public details?: any) {
    super(message);
    this.name = "PayNodeException";
  }
}
