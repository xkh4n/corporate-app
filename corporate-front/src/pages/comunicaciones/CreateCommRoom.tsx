import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { Button, Field, Input, Select } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { costCenterService } from "../../services";
import { commRoomService } from "../../services/commRoomService";
import type { CostCenter } from "../../types/costCenter";
import { PAGE_CLASS, TITLE_CLASS } from "./commRoomUi";

// Crear Sala (plan 016): sala de comunicaciones de una tienda o sucursal, que depende de un centro de costo.
const REQUIRED_PERMISSIONS = ["comm-rooms:create", "cost-centers:read"] as const;

export default function CreateCommRoom() {
  const navigate = useNavigate();
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [name, setName] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    costCenterService
      .list({ limit: 1000, sortBy: "code" })
      .then((res) => setCostCenters(res.items))
      .catch((error) => handleError(error, navigate));
  }, [navigate]);

  const canSubmit = name.trim() !== "" && costCenterId !== "" && address.trim() !== "";

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) {
      showErrorToast("Complete el nombre, la dependencia y la dirección");
      return;
    }
    setSaving(true);
    try {
      const room = await commRoomService.create({ name: name.trim(), costCenterId: Number(costCenterId), address: address.trim() });
      showSuccessToast(`Sala ${room.name} creada en ${room.costCenterName}`);
      setName("");
      setCostCenterId("");
      setAddress("");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className={PAGE_CLASS}>
        <h1 className={TITLE_CLASS}>Crear Sala</h1>
        <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <form
            className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <Field label="Nombre de la sala" htmlFor="roomName">
              <Input id="roomName" value={name} maxLength={120} placeholder="Ej: Sala de comunicaciones principal" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Dependencia (centro de costo)" htmlFor="roomCostCenter">
              <Select id="roomCostCenter" value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
                <option value="">Seleccione un centro de costo</option>
                {costCenters.map((costCenter) => (
                  <option key={costCenter.id} value={costCenter.id}>
                    {costCenter.code} - {costCenter.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Dirección" htmlFor="roomAddress">
              <Input id="roomAddress" value={address} maxLength={255} placeholder="Calle, número, piso u oficina" onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={saving} disabled={!canSubmit} className="w-48">
                Crear sala
              </Button>
            </div>
          </form>
        </div>
      </div>
    </RequirePermissions>
  );
}
