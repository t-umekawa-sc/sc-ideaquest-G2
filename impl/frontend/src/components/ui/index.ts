// 機能横断の共有UI（業務層）の公開API（§4.1 components）。
export { Avatar } from "./Avatar";
export { Button } from "./Button";
export { Card, CardTitle } from "./Card";
export { DataTable } from "./DataTable";
export type {
  DataTableColumn,
  DataTableProps,
  CardLayout,
  SortKey,
  SortDir,
  FilterCond,
  ColumnFilter,
  QueryState,
  ServerResult,
  DataTableServer,
} from "./DataTable";
export { Field } from "./Field";
export { FormSummary } from "./FormSummary";
export { FormFooterError } from "./FormFooterError";
export { useFormErrorNotice } from "./useFormErrorNotice";
export { Modal, ModalBody, ModalFooter } from "./Modal";
export { RouteModal } from "./RouteModal";
export { Pager } from "./Pager";
export { Progress, Spinner, BlockOverlay } from "./Progress";
export { SnackbarProvider, useSnackbar } from "./Snackbar";
export type { SnackType, SnackReward, SnackOptions } from "./Snackbar";
export { GameNav } from "./GameNav";
export { ConfirmProvider, useConfirm } from "./ConfirmDialog";
export type { ConfirmVariant, ConfirmCost, ConfirmOptions } from "./ConfirmDialog";
export { RowMenu } from "./RowMenu";
export type { RowMenuItem } from "./RowMenu";
export { Swatches, SWATCH_PRESETS } from "./Swatches";
