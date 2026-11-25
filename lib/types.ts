export type ScanFormat = 'DATA_MATRIX' | 'QR_CODE' | 'MANUAL';

export type BoxStatus = 'assembling' | 'completed';

export interface UserProfile {
  uid: string;
  login: string;
  displayName: string;
  createdAt?: unknown;
}

export interface AssemblyBox {
  id: string;
  boxCode: string;
  boxNumber: string;
  operatorId: string;
  operatorLogin: string;
  status: BoxStatus;
  itemsCount: number;
  createdAt?: { seconds: number; nanoseconds: number } | null;
  updatedAt?: { seconds: number; nanoseconds: number } | null;
  completedAt?: { seconds: number; nanoseconds: number } | null;
}

export interface ScannedItem {
  id: string;
  boxId: string;
  operatorId: string;
  rawCode: string;
  gtin: string;
  serial: string;
  cryptoTail: string;
  format: ScanFormat;
  scannedAt?: { seconds: number; nanoseconds: number } | null;
}
