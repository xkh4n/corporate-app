import type { AccountingStage, Classification } from "./assetAccounting";

// Baja contable de activos (plan 008). Espejo de services/postgres/assetWriteOff.service.ts.

export type WriteOffStatus = "DRAFT" | "CONFIRMED";

export interface EligibleWriteOffAsset {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  costCenterName: string | null;
  productName: string | null;
  classification: Classification;
  stage: AccountingStage;
  bookValue: string;
}

export interface WriteOffPhoto {
  id: number;
  assetId: number;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface WriteOffLine {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  statusCode: string;
  costCenterName: string | null;
  productName: string | null;
  classification: Classification;
  stage: AccountingStage;
  bookValue: string;
  photos: WriteOffPhoto[];
}

export interface WriteOffSummary {
  id: number;
  status: WriteOffStatus;
  writeOffDate: string | null;
  reason: string | null;
  notary: string | null;
  certificateNumber: string | null;
  hasCertificate: boolean;
  lineCount: number;
  assetCount: number;
  totalBookValue: string;
  createdBy: number;
  createdAt: string;
  confirmedBy: number | null;
  confirmedAt: string | null;
}

export interface WriteOffDetail extends WriteOffSummary {
  lines: WriteOffLine[];
}

export interface WriteOffUpdate {
  writeOffDate?: string;
  reason?: string;
  notary?: string | null;
  certificateNumber?: string | null;
  assetIds?: number[];
}
