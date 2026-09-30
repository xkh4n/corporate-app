import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { Button } from "../../../components/ui/Button";
import { Field } from "../../../components/ui/Field";
import { Input } from "../../../components/ui/Input";
import { Spinner } from "../../../components/ui/Spinner";
import { Select } from "../../../components/ui/Select";
import { showSuccessToast } from "../../../components/Toast";
import { handleError } from "../../../lib/Errors";
import { createValidationError } from "../../../lib/Errors/CustomError";
import { IsEmail, IsName, IsParagraph, IsPhone, IsRut } from "../../../lib/Validations";
import {
  addressService,
  businessPartnerService,
  cityService,
  countryService,
  stateService,
  supplierContactService,
  supplierDeliveryTermsService,
  supplierService,
  supplierServiceTypeService,
} from "../../../services";
import type { City, Country, State, SupplierDeliveryTerms, SupplierServiceType } from "../../../types";

// Permisos requeridos para completar el flujo entero (no solo para ver la
// pantalla): crea un BusinessPartner + Address + Supplier, y ademas deja
// elegir/crear tipo de servicio y condiciones de despacho del catalogo.
const REQUIRED_PERMISSIONS = [
  "business-partners:create",
  "suppliers:create",
  "supplier-service-types:create",
  "supplier-delivery-terms:create",
] as const;

export default function CreateBusinessPartnerPage() {
  const navigate = useNavigate();

  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [countries, setCountries] = useState<Country[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [serviceTypes, setServiceTypes] = useState<SupplierServiceType[]>([]);
  const [deliveryTerms, setDeliveryTerms] = useState<SupplierDeliveryTerms[]>([]);

  const [legalName, setLegalName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [businessLine, setBusinessLine] = useState("");

  const [addressType, setAddressType] = useState("FISCAL");
  const [addressLine, setAddressLine] = useState("");
  const [countryId, setCountryId] = useState("");
  const [cityId, setCityId] = useState("");
  const [stateId, setStateId] = useState("");

  const [serviceTypeId, setServiceTypeId] = useState("");
  const [deliveryTermsId, setDeliveryTermsId] = useState("");
  const [paymentTermDays, setPaymentTermDays] = useState("");

  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactPosition, setContactPosition] = useState("");

  // Ids ya creados en un intento previo que fallo a mitad de camino. No hay
  // endpoint de borrado para business-partners/suppliers en el backend, asi
  // que si el usuario aprieta "Guardar" de nuevo despues de un error, el
  // submit NO debe recrear lo que ya quedo guardado -solo retoma desde el
  // paso que fallo.
  const [businessPartnerId, setBusinessPartnerId] = useState<number | null>(null);
  const [addressCreated, setAddressCreated] = useState(false);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [countriesRes, citiesRes, statesRes, serviceTypesRes, deliveryTermsRes] = await Promise.all([
          countryService.list({ limit: 1000 }),
          cityService.list({ limit: 1000 }),
          stateService.list({ limit: 1000 }),
          supplierServiceTypeService.list({ limit: 1000 }),
          supplierDeliveryTermsService.list({ limit: 1000 }),
        ]);
        if (cancelled) return;
        setCountries(countriesRes.items);
        setCities(citiesRes.items);
        setStates(statesRes.items);
        setServiceTypes(serviceTypesRes.items);
        setDeliveryTerms(deliveryTermsRes.items);
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
    setLegalName("");
    setNationalId("");
    setBusinessLine("");
    setAddressType("FISCAL");
    setAddressLine("");
    setCountryId("");
    setCityId("");
    setStateId("");
    setServiceTypeId("");
    setDeliveryTermsId("");
    setPaymentTermDays("");
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setContactPosition("");
    setBusinessPartnerId(null);
    setAddressCreated(false);
    setSupplierId(null);
  }

  // Ademas del "campo obligatorio", cada dato se valida contra su regex real
  // (o, en el caso del RUT, contra el digito verificador -no alcanza con que
  // "parezca" un RUT) antes de gastar un request contra el backend. Ver
  // lib/Validations.
  function validate(): void {
    if (!legalName.trim() || !IsName(legalName.trim())) {
      throw createValidationError("La razon social no es valida");
    }
    if (!nationalId.trim() || !IsRut(nationalId.trim())) {
      throw createValidationError("El RUT no es valido");
    }
    if (businessLine.trim() && !IsParagraph(businessLine.trim())) {
      throw createValidationError("El giro no es valido");
    }
    if (!addressType.trim()) throw createValidationError("Falta el tipo de direccion");
    if (!addressLine.trim() || !IsParagraph(addressLine.trim())) {
      throw createValidationError("La direccion no es valida");
    }
    if (!stateId) throw createValidationError("Debe seleccionar pais, ciudad y comuna");
    if (!serviceTypeId) throw createValidationError("Debe seleccionar el tipo de servicio");
    if (!deliveryTermsId) throw createValidationError("Debe seleccionar las condiciones de despacho");
    if (paymentTermDays && (!Number.isInteger(Number(paymentTermDays)) || Number(paymentTermDays) <= 0)) {
      throw createValidationError("Los dias de pago deben ser un numero entero positivo");
    }
    if (!contactName.trim() || !IsName(contactName.trim())) {
      throw createValidationError("El nombre del contacto no es valido");
    }
    if (!contactEmail.trim() || !IsEmail(contactEmail.trim())) {
      throw createValidationError("El correo del contacto no es valido");
    }
    if (contactPhone.trim() && !IsPhone(contactPhone.trim())) {
      throw createValidationError("El telefono del contacto no es valido");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
        validate();

        let bpId = businessPartnerId;
        if (!bpId) {
          const businessPartner = await businessPartnerService.create({
            legalName: legalName.trim(),
            nationalId: nationalId.trim(),
            businessLine: businessLine.trim() || undefined,
          });
          bpId = businessPartner.id;
          setBusinessPartnerId(bpId);
        }

        if (!addressCreated) {
          await addressService.create({
            businessPartnerId: bpId,
            addressType: addressType.trim(),
            addressLine: addressLine.trim(),
            stateId: Number(stateId),
          });
          setAddressCreated(true);
        }

        let supId = supplierId;
        if (!supId) {
          const supplier = await supplierService.create({
            businessPartnerId: bpId,
            serviceTypeId: Number(serviceTypeId),
            deliveryTermsId: Number(deliveryTermsId),
            paymentTermDays: paymentTermDays ? Number(paymentTermDays) : undefined,
          });
          supId = supplier.id;
          setSupplierId(supId);
        }

        await supplierContactService.create({
          supplierId: supId,
          name: contactName.trim(),
          email: contactEmail.trim().toLowerCase(),
          phone: contactPhone.trim() || undefined,
          position: contactPosition.trim() || undefined,
        });

      showSuccessToast("Proveedor creado exitosamente");
      resetForm();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center justify-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Creacion de Proveedor</h1>

        {catalogsLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
            <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8">
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
                        {/* RAZON SOCIAL */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-4 min-[1000px]:col-span-5 min-[1200px]:col-span-5 min-[1400px]:col-span-4">
                            <Field label="Razon social" htmlFor="legalName">
                            <Input
                                id="legalName"
                                value={legalName}
                                maxLength={200}
                                onChange={(e) => setLegalName(e.target.value.toUpperCase())}
                                required
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* GIRO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-4 min-[1000px]:col-span-5 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                            <Field label="Giro" htmlFor="businessLine">
                            <Input
                                id="businessLine"
                                value={businessLine}
                                maxLength={150}
                                onChange={(e) => setBusinessLine(e.target.value.toUpperCase())}
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-6 min-[1000px]:col-span-4 min-[1200px]:col-span-5 min-[1400px]:col-span-4">
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-2">
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-3 min-[1200px]:col-span-4 min-[1400px]:col-span-3">
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
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-3 min-[1200px]:col-span-4 min-[1400px]:col-span-3">
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
                        {/* SERVICIO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-2 min-[1200px]:col-span-2 min-[1400px]:col-span-2">
                            <Field label="Tipo de servicio" htmlFor="serviceTypeId">
                            <Select
                                id="serviceTypeId"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={serviceTypeId}
                                onChange={(e) => setServiceTypeId(e.target.value)}
                                required
                            >
                                <option value="">Seleccione un tipo de servicio</option>
                                {serviceTypes.map((serviceType) => (
                                <option key={serviceType.id} value={serviceType.id}>
                                    {serviceType.name}
                                </option>
                                ))}
                            </Select>
                            </Field>
                        </div>
                        {/* CONDICIONES DE DESPACHO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-2 min-[1200px]:col-span-3 min-[1400px]:col-span-2">
                            <Field label="Condiciones de despacho" htmlFor="deliveryTermsId">
                            <Select
                                id="deliveryTermsId"
                                className="bg-zinc-100 focus:bg-indigo-100"
                                value={deliveryTermsId}
                                onChange={(e) => setDeliveryTermsId(e.target.value)}
                                required
                            >
                                <option value="">Seleccione condiciones de despacho</option>
                                {deliveryTerms.map((term) => (
                                <option key={term.id} value={term.id}>
                                    {term.name}
                                </option>
                                ))}
                            </Select>
                            </Field>
                        </div>
                        {/* CONDICIONES DE PAGO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-3 min-[1200px]:col-span-3 min-[1400px]:col-span-2">
                            <Field label="Condiciones de pago (dias)" htmlFor="paymentTermDays">
                            <Input
                                id="paymentTermDays"
                                type="number"
                                min={1}
                                step={1}
                                value={paymentTermDays}
                                onChange={(e) => setPaymentTermDays(e.target.value)}
                                placeholder="Ej: 30"
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* CONTACTO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-6 min-[1000px]:col-span-3 min-[1200px]:col-span-4 min-[1400px]:col-span-6">
                            <Field label="Contacto" htmlFor="contactName">
                            <Input
                                id="contactName"
                                value={contactName}
                                maxLength={150}
                                onChange={(e) => setContactName(e.target.value.toUpperCase())}
                                required
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* CORREO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-5 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                            <Field label="Correo" htmlFor="contactEmail">
                            <Input
                                id="contactEmail"
                                type="email"
                                value={contactEmail}
                                maxLength={150}
                                onChange={(e) => setContactEmail(e.target.value.toLowerCase())}
                                required
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* FONO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-3 min-[1200px]:col-span-3 min-[1400px]:col-span-3">
                            <Field label="Telefono" htmlFor="contactPhone">
                            <Input
                                id="contactPhone"
                                value={contactPhone}
                                maxLength={30}
                                onChange={(e) => setContactPhone(e.target.value)}
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                        {/* CARGO */}
                        <div className="w-full max-[799px]:w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-4 min-[1400px]:col-span-5">
                            <Field label="Cargo" htmlFor="contactPosition">
                            <Input
                                id="contactPosition"
                                value={contactPosition}
                                maxLength={100}
                                onChange={(e) => setContactPosition(e.target.value.toUpperCase())}
                                className="bg-zinc-100 focus:bg-indigo-100"
                            />
                            </Field>
                        </div>
                    </div>
                    <div className="flex flex-1 row-auto justify-center mt-4">
                        <Button type="submit" loading={submitting} className="w-full sm:w-60">
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
