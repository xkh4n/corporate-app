import { Field } from "../../../components/ui/Field";
import { Select } from "../../../components/ui/Select";
import type { Employee } from "../../../types";
import { employeeLabel } from "./employeeLabel";

export function EmployeePicker({
  employees,
  value,
  onChange,
  disabled,
}: {
  employees: Employee[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label="Colaborador" htmlFor="employeeId">
      <Select
        id="employeeId"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required
        className="bg-zinc-100 focus:bg-indigo-100"
      >
        <option value="">Seleccione el colaborador</option>
        {employees.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employeeLabel(employee)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
