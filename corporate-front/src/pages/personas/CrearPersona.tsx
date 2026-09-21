import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { useAuth } from "../../auth/useAuth";
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
  positionService,
  costCenterService,
  employeeContractService,
  payrollService,
  previsionalService,
} from "../../services";
import type {
  City,
  Country,
  State,
  CostCenter,
  Position,
  PersonNationality,
  PersonSex,
  GratificationType,
  EmployerInheritance,
  PrevisionalInstitution,
} from "../../types";
import { ContractSection } from "./contract/ContractSection";
import { emptyContractForm, toContractInput, type ContractFormState } from "./contract/contractForm";
import { PrevisionalSection } from "./previsional/PrevisionalSection";
import {
  emptyPrevisionalForm,
  toHealthInput,
  toPensionInput,
  type PrevisionalFormState,
} from "./previsional/previsionalForm";

// Permisos requeridos para completar el flujo entero (no solo para ver la
// pantalla): crea un Person + Address + Employee + User encadenados, mas
// employees:read para poblar el combo de Cargos (GET /positions reutiliza
// ese permiso, ver position.routes.ts). AFP y salud (previsional-profiles) se
// asignan en el mismo alta que el contrato: ambos alimentan la liquidacion.
const REQUIRED_PERMISSIONS = [
  "persons:create",
  "addresses:create",
  "employees:create",
  "employees:read",
  "employee-contracts:create",
  "previsional-institutions:read",
  "previsional-profiles:update",
  "users:create",
] as const;

// EMP + los digitos antes del guion del RUT (ej. "12.667.399-4" -> los
// puntos se descartan igual que el guion- -> "EMP12667399").
function buildEmployeeCode(documentId: string): string {
  const digitsBeforeHyphen = documentId.split("-")[0].replace(/\D/g, "");
  return `EMP${digitsBeforeHyphen}`;
}

export default function CreatePersonPage() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [countries, setCountries] = useState<Country[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [ccostos, setCcostos] = useState<CostCenter[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  const [principalName, setPrincipalName] = useState("");
  // lastName = apellido paterno. Materno, sexo y nacionalidad son datos que
  // exige Previred (campos 3-7 del formato de nomina) y no se pueden inferir.
  const [lastName, setLastName] = useState("");
  const [maternalLastName, setMaternalLastName] = useState("");
  const [sex, setSex] = useState<PersonSex | "">("");
  const [nationality, setNationality] = useState<"" | "0" | "1">("");
  const [nationalId, setNationalId] = useState("");
  const [email, setEmail] = useState("");
  const [phone01, setPhone01] = useState("");
  const [birthday, setBirthday] = useState("");

  const [ccostSelected, setCcostSelected] = useState("");

  const [positionSelected, setPositionSelected] = useState("");
  const [username, setUsername] = useState("");

  const [addressType, setAddressType] = useState("PARTICULAR / COMERCIAL");
  const [addressLine, setAddressLine] = useState("");
  const [countryId, setCountryId] = useState("");
  const [cityId, setCityId] = useState("");
  const [stateId, setStateId] = useState("");

  // Contrato y gratificacion. El sistema de la empresa (payroll-settings) solo
  // PRE-LLENA el tipo: si el usuario no tiene payroll-settings:read el formulario
  // arranca en ART50 y el usuario elige, no se bloquea el alta.
  const [contract, setContract] = useState<ContractFormState>(() => emptyContractForm());
  const [companyGratification, setCompanyGratification] = useState<GratificationType | null>(null);
  const [companyAdvancePercentage, setCompanyAdvancePercentage] = useState<number | null>(null);
  const [contractCreated, setContractCreated] = useState(false);

  // Afiliacion previsional (AFP + salud). CCAF y mutual NO se piden aca: son de
  // la empresa y el colaborador las hereda; solo se muestran si el usuario puede
  // leer esa configuracion.
  const [previsional, setPrevisional] = useState<PrevisionalFormState>(() => emptyPrevisionalForm());
  const [afps, setAfps] = useState<PrevisionalInstitution[]>([]);
  const [healthInstitutions, setHealthInstitutions] = useState<PrevisionalInstitution[]>([]);
  const [employer, setEmployer] = useState<EmployerInheritance | null>(null);
  const [pensionAssigned, setPensionAssigned] = useState(false);
  const [healthAssigned, setHealthAssigned] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [personId, setPersonId] = useState<number | null>(null);
  const [addressCreated, setAddressCreated] = useState(false);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [userCreated, setUserCreated] = useState(false);


  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [
          countriesRes,
          citiesRes,
          statesRes,
          positionRes,
          costRes,
          payrollSettings,
          afpsRes,
          healthRes,
          employerSettings,
        ] = await Promise.all([
          countryService.list({ limit: 1000 }),
          cityService.list({ limit: 1000 }),
          stateService.list({ limit: 1000 }),
          positionService.list({ limit: 1000 }),
          costCenterService.list({ limit: 1000 }),
          can("payroll-settings:read") ? payrollService.getSettings() : Promise.resolve(null),
          previsionalService.listInstitutions("AFP", { limit: 100 }),
          previsionalService.listInstitutions("SALUD", { limit: 100 }),
          can("previred-settings:read") ? previsionalService.getEmployerSettings() : Promise.resolve(undefined),
        ]);
        if (cancelled) return;
        if (payrollSettings?.gratificationSystem) {
          setCompanyGratification(payrollSettings.gratificationSystem);
          setContract(emptyContractForm(payrollSettings.gratificationSystem));
        }
        setCompanyAdvancePercentage(payrollSettings?.gratificationMonthlyAdvancePercentage ?? null);
        setCountries(countriesRes.items);
        setCities(citiesRes.items);
        setStates(statesRes.items);
        setPositions(positionRes.items);
        setCcostos(costRes.items);
        setAfps(afpsRes.items);
        setHealthInstitutions(healthRes.items);
        // undefined = sin permiso (no se avisa nada); null = la empresa aun no configura.
        if (employerSettings !== undefined) {
          setEmployer({
            ccaf: employerSettings?.ccaf ?? null,
            mutual: employerSettings?.mutual ?? null,
            mutualBranchCode: employerSettings?.mutualBranchCode ?? null,
            workAccidentRate: employerSettings?.workAccidentRate ?? null,
          });
        }
      } catch (error) {
        handleError(error, navigate);
      } finally {
        if (!cancelled) setCatalogsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, can]);

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
    setMaternalLastName("");
    setSex("");
    setNationality("");
    setNationalId("");
    setEmail("");
    setPhone01("");
    setBirthday("");
    setCcostSelected("");
    setPositionSelected("");
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
    setContract(emptyContractForm(companyGratification ?? "ART50"));
    setContractCreated(false);
    setPrevisional(emptyPrevisionalForm());
    setPensionAssigned(false);
    setHealthAssigned(false);
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
      throw createValidationError("El apellido paterno no es valido");
    }
    // Previred lo marca "Condicional": puede no existir, pero si viene debe ser valido.
    if (maternalLastName.trim() && !IsName(maternalLastName.trim())) {
      throw createValidationError("El apellido materno no es valido");
    }
    if (!sex) throw createValidationError("Debe seleccionar el sexo");
    if (!nationality) throw createValidationError("Debe seleccionar la nacionalidad");
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
    if (!positionSelected) throw createValidationError("Debe seleccionar el cargo");
    if (!username.trim() || username.trim().length < 3) {
      throw createValidationError("El nombre de usuario debe tener al menos 3 caracteres");
    }
    // employeeId todavia no existe: solo interesa que el contrato sea valido.
    toContractInput(contract, 0);
    toPensionInput(previsional);
    toHealthInput(previsional, healthInstitutions);
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
          maternalLastName: maternalLastName.trim() || undefined,
          // validate() ya garantizo que no es "": TS no lo estrecha entre funciones.
          sex: sex || undefined,
          nationality: Number(nationality) as PersonNationality,
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
          positionId: positionSelected,
        });
        empId = employee.id;
        setEmployeeId(empId);
      }

      // Sueldo base y gratificacion: se crean con el colaborador, antes del
      // usuario, porque sin contrato no hay remuneracion que liquidar. Cada paso
      // tiene su bandera para que un reintento no repita los ya hechos.
      if (!contractCreated) {
        await employeeContractService.create(toContractInput(contract, empId));
        setContractCreated(true);
      }

      // Afiliacion previsional: despues del contrato y antes del usuario, cada
      // pieza con su bandera. Son dos PUT sobre el mismo perfil, en serie: el
      // primero lo crea y el segundo lo completa.
      if (!pensionAssigned) {
        await previsionalService.assignPension(empId, toPensionInput(previsional));
        setPensionAssigned(true);
      }
      if (!healthAssigned) {
        await previsionalService.assignHealth(empId, toHealthInput(previsional, healthInstitutions));
        setHealthAssigned(true);
      }

      if (!userCreated) {
        // El rol del usuario ya no se elige directamente: se hereda del
        // cargo seleccionado (Position.roleId, ver NuevoCargo.tsx) -asi el
        // acceso al sistema queda gobernado por el cargo, no por una
        // eleccion libre en este formulario.
        const position = positions.find((item) => item.id === positionSelected);
        if (!position) throw createValidationError("El cargo seleccionado no es valido");

        // Sin password: el backend aplica la password fija por defecto y
        // marca mustChangePassword (ver createUser en corporate-api).
        await userService.create({
          personId: pId,
          roleId: position.roleId,
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
                        {/* APELLIDO PATERNO (persons.last_name) */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-2 min-[1400px]:col-span-3">
                            <Field label="Apellido paterno" htmlFor="lastName">
                            <Input
                                id="lastName"
                                value={lastName}
                                maxLength={100}
                                onChange={(e) => setLastName(e.target.value.toUpperCase())}
                                required
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* APELLIDO MATERNO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-2 min-[1400px]:col-span-3">
                            <Field label="Apellido materno" htmlFor="maternalLastName">
                            <Input
                                id="maternalLastName"
                                value={maternalLastName}
                                maxLength={100}
                                onChange={(e) => setMaternalLastName(e.target.value.toUpperCase())}
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* SEXO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-2 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                            <Field label="Sexo" htmlFor="sex">
                            <Select
                                id="sex"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={sex}
                                onChange={(e) => setSex(e.target.value as PersonSex | "")}
                                required
                            >
                                <option value="">Seleccione</option>
                                <option value="M">Masculino</option>
                                <option value="F">Femenino</option>
                            </Select>
                            </Field>
                        </div>
                        {/* NACIONALIDAD */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                            <Field label="Nacionalidad" htmlFor="nationality">
                            <Select
                                id="nationality"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={nationality}
                                onChange={(e) => setNationality(e.target.value as "" | "0" | "1")}
                                required
                            >
                                <option value="">Seleccione</option>
                                <option value="0">Chilena</option>
                                <option value="1">Extranjera</option>
                            </Select>
                            </Field>
                        </div>
                        {/* TIPO DIRECCION */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                            <Field label="Tipo de direccion" htmlFor="addressType">
                              <Select
                                id="nationality"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={addressType}
                                onChange={(e) => setAddressType(e.target.value.toUpperCase())}
                                required
                            >
                                <option value="">Seleccione</option>
                                <option value="PARTICULAR">PARTICULAR</option>
                                <option value="FISCAL">FISCAL</option>
                            </Select>
                            </Field>
                        </div>
                        {/* DIRECCION */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-4 min-[1000px]:col-span-4 min-[1200px]:col-span-4 min-[1400px]:col-span-6">
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-4 min-[1200px]:col-span-4 min-[1400px]:col-span-4">
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-2 min-[1200px]:col-span-2 min-[1400px]:col-span-4">
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-4 min-[1400px]:col-span-4">
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
                        {/* CARGO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-4 min-[1400px]:col-span-4">
                            <Field label="Cargo" htmlFor="position_user">
                            <Select
                                id="position_user"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={positionSelected}
                                onChange={(e) => setPositionSelected(e.target.value)}
                                required
                            >
                                <option value="">Seleccione el Cargo</option>
                                {positions.map((position) => (
                                <option key={position.id} value={position.id}>
                                    {position.title.toUpperCase()}
                                </option>
                                ))}
                            </Select>
                            </Field>
                        </div>
                        {/* USERNAME */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-2 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                            <Field label="Nombre de Usuario" htmlFor="username">
                            <Input
                                id="username"
                                type="text"
                                min={1}
                                step={1}
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Maximo 30"
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* CORREO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-4 min-[1400px]:col-span-4">
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-2 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
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
                    <ContractSection
                        value={contract}
                        onChange={setContract}
                        companyAdvancePercentage={companyAdvancePercentage}
                        disabled={submitting}
                    />
                    <PrevisionalSection
                        value={previsional}
                        onChange={setPrevisional}
                        afps={afps}
                        healthInstitutions={healthInstitutions}
                        employer={employer}
                        disabled={submitting}
                    />
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
