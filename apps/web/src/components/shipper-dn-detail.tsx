/** Shared delivery-note detail types and small helpers (no components). */

type ShipToLocationDetail = {
  ship_to_name: string;
  street1: string | null;
  street2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  country_code: string | null;
  country_name: string | null;
};

type LineRow = {
  id: string;
  doc_item: number;
  material_code: string | null;
  material_description: string | null;
  shipped_qty: string | null;
};

type PackBox = {
  id: string;
  sort_order: number;
  box_number: string | null;
  weight_lb: string;
  length_in: string;
  width_in: string;
  height_in: string;
};

type PackSessionDn = {
  id: string;
  dn_number: string;
  current_status?: string;
};

type CompletedPackSession = {
  pack_completion_note?: string | null;
  delivery_notes?: PackSessionDn[];
  boxes: PackBox[];
};

export type WorkflowActor = {
  id: string;
  email: string;
  display_name: string | null;
};

export type WorkflowHandoff = {
  picked_by: WorkflowActor | null;
  packed_by: WorkflowActor | null;
  shipped_by: WorkflowActor | null;
};

export type LatestShipment = {
  tracking_number: string | null;
  invoice_number?: string | null;
  ship_date: string;
  carrier_code: string;
  shipped_by?: WorkflowActor | null;
};

export type CarrierAccountRow = {
  carrier_code: string;
  account_number: string;
};

export type ShipperDnDetail = {
  sold_to_code: string;
  sold_to_name: string;
  ship_to_code: string;
  ship_to_name: string;
  ship_to_region_state: string | null;
  ship_to_location?: ShipToLocationDetail | null;
  shipping_type: string | null;
  customer_email?: string | null;
  fed_id_number?: string | null;
  matched_carrier_accounts?: CarrierAccountRow[];
  lines: LineRow[];
  completed_pack_sessions?: CompletedPackSession[];
};

export type ShipperDnDetailWorkspaceProps = {
  detail: ShipperDnDetail;
  currentDnId: string;
  currentStatus: string;
  latestShipment?: LatestShipment | null;
  workflowHandoff?: WorkflowHandoff | null;
};

export function formatWorkflowActorLabel(actor: WorkflowActor | null | undefined): string {
  if (!actor) return "—";
  const name = actor.display_name?.trim();
  if (name) return name;
  return actor.email?.trim() || "—";
}
