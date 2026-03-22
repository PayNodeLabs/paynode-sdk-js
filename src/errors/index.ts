export enum ErrorCode {
  RpcError = "RpcError",
  InsufficientFunds = "InsufficientFunds",
  AmountTooLow = "AmountTooLow",
  TokenNotAccepted = "TokenNotAccepted",
  TransactionFailed = "TransactionFailed",
  DuplicateTransaction = "DuplicateTransaction",
  InvalidReceipt = "InvalidReceipt",
  InternalError = "InternalError",
  TransactionNotFound = "TransactionNotFound",
  WrongContract = "WrongContract",
  OrderMismatch = "OrderMismatch",
  MissingReceipt = "MissingReceipt",
}

export class PayNodeException extends Error {
  constructor(public message: string, public code: ErrorCode, public details?: any) {
    super(message);
    this.name = "PayNodeException";
  }
}
