// Espejo de corporate-api/src/services/postgres/assetAccounting.service.ts,
// assetDepreciation.service.ts y assetAccountingPolicy.service.ts (plan 007).
export type Classification = "FIXED_ASSET" | "EXPENSE" | "INVENTORY";
export type AccountingStage = "CLASSIFIED" | "COSTED" | "CAPITALIZED" | "DEPRECIATING" | "FULLY_DEPRECIATED";
export type DepreciationMethod = "LINEAR" | "ACCELERATED";

export interface PendingAccountingAsset {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  value: string | null;
  statusName: string;
  costCenterName: string | null;
  productName: string | null;
}

export interface AccountingRecord extends PendingAccountingAsset {
  classification: Classification;
  classId: number | null;
  className: string | null;
  stage: AccountingStage;
  acquisitionCost: string | null;
  capitalizedCost: string | null;
  attributableTotal: string;
  usefulLifeMonths: number | null;
  depreciationMethod: DepreciationMethod | null;
  residualValue: string | null;
  depreciationStartPeriod: string | null;
  accumulatedDepreciation: string;
  bookValue: string | null;
  classifiedAt: string | null;
  costedAt: string | null;
  capitalizedAt: string | null;
}

export interface AttributableCost {
  id: number;
  concept: string;
  amount: string;
  documentRef: string | null;
  createdBy: number | null;
  createdAt: string;
}

export interface ScheduleRow {
  period: string;
  installment: number;
  amount: number;
  accumulated: number;
  bookValue: number;
}

export interface DepreciationRun {
  id: number;
  period: string;
  status: "CLOSED" | "VOIDED";
  assetCount: number;
  totalAmount: string;
  closedBy: number | null;
  closedAt: string;
  voidedBy: number | null;
  voidedAt: string | null;
}

export interface DepreciationLine {
  assetId: number;
  tag: string;
  amount: string;
  accumulated: string;
  bookValue: string;
}

export interface NextClosePreview {
  period: string | null;
  canClose: boolean;
  reason?: string;
  lines: DepreciationLine[];
  totalAmount: string;
}

export interface AccountingPolicy {
  capitalizationThreshold: string;
  updatedBy: number | null;
  updatedAt: string;
}

export interface AccountingClass {
  id: number;
  code: string;
  name: string;
  usefulLifeMonths: number;
  defaultMethod: DepreciationMethod;
  residualRate: string;
  isActive: boolean;
}

export interface AccountingClassInput {
  code: string;
  name: string;
  usefulLifeMonths: number;
  defaultMethod: DepreciationMethod;
  residualRate: number;
  isActive?: boolean;
}
