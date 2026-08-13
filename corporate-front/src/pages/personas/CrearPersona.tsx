import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { Select } from "../../components/ui/Select";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { IsEmail, IsName, IsParagraph, IsPhone, IsRut } from "../../lib/Validations";
import {
  addressService,
  cityService,
  countryService,
  stateService,
  personService,
  employeeService,
  userService,
  roleService,
  costCenterService
} from "../../services";
import type { City, Country, State, CostCenter, Role } from "../../types";

// Permisos requeridos para completar el flujo entero (no solo para ver la
// pantalla): crea un Person + Address + Employee + User encadenados.
const REQUIRED_PERMISSIONS = [
  "persons:create",
  "addresses:create",
  "employees:create",
  "users:create",
] as const;

// EMP + los digitos antes del guion del RUT (ej. "12.667.399-4" -> los
// puntos se descartan igual que el guion- -> "EMP12667399"). Se calcula en
// el front a partir del mismo documentId que ya se manda para crear la
// Person -no hay endpoint de correlativo ni nada que reservar, es una
// transformacion pura y determinista del mismo dato (decision del usuario:
// mantener el JSON de POST /employees tal cual esta hoy en el backend).
function buildEmployeeCode(documentId: string): string {
  const digitsBeforeHyphen = documentId.split("-")[0].replace(/\D/g, "");
  return `EMP${digitsBeforeHyphen}`;
}

export default function CreatePersonPage() {
  const navigate = useNavigate();

  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [countries, setCountries] = useState<Country[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [ccostos, setCcostos] = useState<CostCenter[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  const [principalName, setPrincipalName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [email, setEmail] = useState("");
  const [phone01, setPhone01] = useState("");
  const [birthday, setBirthday] = useState("");

  const [ccostSelected, setCcostSelected] = useState("");

  const [roleSelected, setRoleSelected] = useState("");
  const [username, setUsername] = useState("");

  const [addressType, setAddressType] = useState("PARTICULAR / COMERCIAL");
  const [addressLine, setAddressLine] = useState("");
  const [countryId, setCountryId] = useState("");
  const [cityId, setCityId] = useState("");
  const [stateId, setStateId] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [personId, setPersonId] = useState<number | null>(null);
  const [addressCreated, setAddressCreated] = useState(false);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [userCreated, setUserCreated] = useState(false);


  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [countriesRes, citiesRes, statesRes, roleRes, costRes] = await Promise.all([
          countryService.list({ limit: 1000 }),
          cityService.list({ limit: 1000 }),
          stateService.list({ limit: 1000 }),
          roleService.list({ limit: 1000 }),
          costCenterService.list({ limit: 1000 }),
        ]);
        if (cancelled) return;
        setCountries(countriesRes.items);
        setCities(citiesRes.items);
        setStates(statesRes.items);
        // Un rol inactivo no puede usarse para iniciar sesion (login() en
        // corporate-api lo rechaza con "Credenciales invalidas" -mismo
        // mensaje generico que una password incorrecta, sin pista alguna):
        // ofrecerlo en el combo deja crear un colaborador que nunca va a
        // poder entrar. roleService.list no tiene filtro isActive server-side,
        // se filtra aca.
        setRoles(roleRes.items.filter((role) => role.isActive));
        setCcostos(costRes.items);
      } catch (error) {
        handleError(error, navigate);
      } finally {
        if (!cancelled) setCatalogsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const citiesForCountry = cities.filter((city) => String(city.countryId) === countryId);
  const statesForCity = states.filter((state) => String(state.cityId) === cityId);

  function handleCountryChange(value: string) {
    setCountryId(value);
    setCityId("");
    setStateId("");
  }

  function handleCityChange(value: string) {
    setCityId(value);
    setStateId("");
  }

  function resetForm() {
    setPrincipalName("");
    setLastName("");
    setNationalId("");
    setEmail("");
    setPhone01("");
    setBirthday("");
    setCcostSelected("");
    setRoleSelected("");
    setUsername("");
    setAddressType("FISCAL");
    setAddressLine("");
    setCountryId("");
    setCityId("");
    setStateId("");
    setPersonId(null);
    setAddressCreated(false);
    setEmployeeId(null);
    setUserCreated(false);
  }

  // Ademas del "campo obligatorio", cada dato se valida contra su regex real
  // (o, en el caso del RUT, contra el digito verificador -no alcanza con que
  // "parezca" un RUT) antes de gastar un request contra el backend. Ver
  // lib/Validations.
  function validate(): void {
    if (!principalName.trim() || !IsName(principalName.trim())) {
      throw createValidationError("Los nombres no son validos");
    }
    if (!lastName.trim() || !IsName(lastName.trim())) {
      throw createValidationError("Los apellidos no son validos");
    }
    if (!nationalId.trim() || !IsRut(nationalId.trim())) {
      throw createValidationError("El RUT no es valido");
    }
    if (!email.trim() || !IsEmail(email.trim())) {
      throw createValidationError("El correo no es valido");
    }
    if (phone01.trim() && !IsPhone(phone01.trim())) {
      throw createValidationError("El telefono no es valido");
    }
    if (!addressType.trim()) throw createValidationError("Falta el tipo de direccion");
    if (!addressLine.trim() || !IsParagraph(addressLine.trim())) {
      throw createValidationError("La direccion no es valida");
    }
    if (!stateId) throw createValidationError("Debe seleccionar pais, ciudad y comuna");
    if (!ccostSelected) throw createValidationError("Debe seleccionar el centro de costo");
    if (!roleSelected) throw createValidationError("Debe seleccionar el rol");
    if (!username.trim() || username.trim().length < 3) {
      throw createValidationError("El nombre de usuario debe tener al menos 3 caracteres");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      validate();

      let pId = personId;
      if (!pId) {
        const person = await personService.create({
          firstName: principalName.trim(),
          lastName: lastName.trim(),
          documentId: nationalId.trim(),
          email: email.trim().toLowerCase(),
          phone: phone01.trim() || undefined,
          birthDate: birthday || undefined,
        });
        pId = person.id;
        setPersonId(pId);
      }

      if (!addressCreated) {
        await addressService.create({
          personId: pId,
          addressType: addressType.trim(),
          addressLine: addressLine.trim(),
          stateId: Number(stateId),
        });
        setAddressCreated(true);
      }

      let empId = employeeId;
      if (!empId) {
        const employee = await employeeService.create({
          personId: pId,
          employeeCode: buildEmployeeCode(nationalId.trim()),
          costCenterId: Number(ccostSelected),
        });
        empId = employee.id;
        setEmployeeId(empId);
      }

      if (!userCreated) {
        // Sin password: el backend aplica la password fija por defecto y
        // marca mustChangePassword (ver createUser en corporate-api).
        await userService.create({
          personId: pId,
          roleId: Number(roleSelected),
          username: username.trim(),
        });
        setUserCreated(true);
      }

      showSuccessToast("Colaborador creado exitosamente");
      resetForm();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Crear Colaborador</h1>

        {catalogsLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
            <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                <form onSubmit={(event) => void handleSubmit(event)} className="w-full">
                    <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                        {/* RUT */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                            <Field label="RUT / ID nacional" htmlFor="nationalId">
                            <Input
                                id="nationalId"
                                value={nationalId}
                                maxLength={20}
                                onChange={(e) => setNationalId(e.target.value)}
                                required
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* PRINCIPAL NAME */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-4 min-[1000px]:col-span-5 min-[1200px]:col-span-4 min-[1400px]:col-span-4">
                            <Field label="Nombres" htmlFor="principalName">
                            <Input
                                id="principalName"
                                value={principalName}
                                maxLength={200}
                                onChange={(e) => setPrincipalName(e.target.value.toUpperCase())}
                                required
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* LASTNAME */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-4 min-[1000px]:col-span-5 min-[1200px]:col-span-4 min-[1400px]:col-span-4">
                            <Field label="Apellidos" htmlFor="lastName">
                            <Input
                                id="lastName"
                                value={lastName}
                                maxLength={150}
                                onChange={(e) => setLastName(e.target.value.toUpperCase())}
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* TIPO DIRECCION */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                            <Field label="Tipo de direccion" htmlFor="addressType">
                            <Input
                                id="addressType"
                                value={addressType}
                                maxLength={30}
                                onChange={(e) => setAddressType(e.target.value.toUpperCase())}
                                required
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* DIRECCION */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-4 min-[1000px]:col-span-4 min-[1200px]:col-span-5 min-[1400px]:col-span-4">
                            <Field label="Direccion" htmlFor="addressLine">
                            <Input
                                id="addressLine"
                                value={addressLine}
                                maxLength={255}
                                onChange={(e) => setAddressLine(e.target.value.toUpperCase())}
                                required
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* PAIS */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-2">
                            <Field label="Pais" htmlFor="countryId">
                            <Select
                                id="countryId"
                                defaultValue=""
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={countryId}
                                onChange={(e) => handleCountryChange(e.target.value)}
                                required
                            >
                                <option value="">Seleccione un pais</option>
                                {countries.map((country) => (
                                <option key={country.id} value={country.id}>
                                    {country.nameCountry}
                                </option>
                                ))}
                            </Select>
                            </Field>
                        </div>
                        {/* CIUDAD */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-2">
                            <Field label="Ciudad" htmlFor="cityId">
                            <Select
                                id="cityId"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={cityId}
                                onChange={(e) => handleCityChange(e.target.value)}
                                disabled={!countryId}
                                required
                            >
                                <option value="">Seleccione una ciudad</option>
                                {citiesForCountry.map((city) => (
                                <option key={city.id} value={city.id}>
                                    {city.nameCity}
                                </option>
                                ))}
                            </Select>
                            </Field>
                        </div>
                        {/* COMUNA */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-2">
                            <Field label="Comuna" htmlFor="stateId">
                            <Select
                                id="stateId"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={stateId}
                                onChange={(e) => setStateId(e.target.value)}
                                disabled={!cityId}
                                required
                            >
                                <option value="">Seleccione una comuna</option>
                                {statesForCity.map((state) => (
                                <option key={state.id} value={state.id}>
                                    {state.nameState}
                                </option>
                                ))}
                            </Select>
                            </Field>
                        </div>
                        {/* CODIGO DE COLABORADOR (autogenerado, solo lectura) */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-2 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                            <Field label="Cod. Colaborador" htmlFor="employeeCodePreview">
                            <Input
                                id="employeeCodePreview"
                                value={nationalId.trim() ? buildEmployeeCode(nationalId.trim()) : ""}
                                placeholder="Se genera desde el RUT"
                                disabled
                                className="bg-zinc-200 text-zinc-500"
                            />
                            </Field>
                        </div>
                        {/* CENTRO COSTO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-2 min-[1400px]:col-span-3">
                            <Field label="Centro de Costo" htmlFor="serviceTypeId">
                            <Select
                                id="serviceTypeId"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={ccostSelected}
                                onChange={(e) => setCcostSelected(e.target.value)}
                                required
                            >
                                <option value="">Seleccione el Centro de Costo</option>
                                {ccostos.map((ccost) => (
                                <option key={ccost.id} value={ccost.id}>
                                    {ccost.name}
                                </option>
                                ))}
                            </Select>
                            </Field>
                        </div>
                        {/* ROLES */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-3 min-[1400px]:col-span-2">
                            <Field label="Seleccione en Role" htmlFor="rol_user">
                            <Select
                                id="rol_user"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={roleSelected}
                                onChange={(e) => setRoleSelected(e.target.value)}
                                required
                            >
                                <option value="">Seleccione el Role</option>
                                {roles.map((term) => (
                                <option key={term.id} value={term.id}>
                                    {term.name.toUpperCase()}
                                </option>
                                ))}
                            </Select>
                            </Field>
                        </div>
                        {/* USERNAME */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-2 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                            <Field label="Nombre de Usuario" htmlFor="username">
                            <Input
                                id="username"
                                type="text"
                                min={1}
                                step={1}
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Ej: 30"
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* CORREO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-3">
                            <Field label="Correo" htmlFor="contactEmail">
                            <Input
                                id="contactEmail"
                                type="email"
                                value={email}
                                maxLength={150}
                                onChange={(e) => setEmail(e.target.value.toLowerCase())}
                                required
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* FONO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-2 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                            <Field label="Telefono" htmlFor="contactPhone">
                            <Input
                                id="contactPhone"
                                value={phone01}
                                maxLength={30}
                                onChange={(e) => setPhone01(e.target.value)}
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                    </div>
                    <div className="flex flex-1 row-auto justify-center mt-4">
                        <Button type="submit" loading={submitting} className="w-60">
                            Guardar
                        </Button>
                    </div>
                </form>
            </div>
        )}
      </div>
    </RequirePermissions>
  );
}
