import { UserModel } from "../models/mssql/user.model";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { getRoleByName } from "../services/postgres/role.service";
import { seedCountries } from "../services/mssql/country.service";
import { seedCities } from "../services/mssql/city.service";
import { seedStates } from "../services/mssql/state.service";
import { seedCostCenters } from "../services/postgres/costCenter.service";
import { readSecretFromEnv } from "../library/secrets";
import { env } from "../library/env";
import { logger } from "../library/logger";

// Datos de referencia (initial-data/{countries,cities,states}.json, ver
// memoria project-erp-scope-and-data-classification): orden secuencial
// obligatorio -cities necesita countries ya insertados para resolver su FK,
// states necesita cities-. Cada seedX es idempotente (no hace nada si la
// tabla ya tiene filas), asi que es seguro llamarlo en cada arranque.
export async function seedGeography(): Promise<void> {
  await seedCountries();
  await seedCities();
  await seedStates();
}

// Bootstrap de "primer arranque": si la tabla users esta vacia (instalacion
// nueva), crea una persona + usuario admin para poder entrar por primera vez
// sin necesitar ya un admin para crear al admin. Password fijo desde secret
// (ADMIN_BOOTSTRAP_PASSWORD_FILE, generado por ensure-backend-secrets.ps1) -
// se espera que se rote/cambie despues del primer login.
export async function seedBootstrapAdmin(): Promise<void> {
  const existingUsers = await UserModel.count();
  if (existingUsers > 0) return;

  const adminRole = await getRoleByName("admin");
  if (!adminRole) {
    logger.warn("No existe el rol 'admin' todavia, se omite el seed del usuario de arranque");
    return;
  }

  const password = readSecretFromEnv(env.bootstrap.adminPasswordFileVar);

  const person = await createPerson({
    firstName: "Admin",
    lastName: "Sistema",
    documentId: "ADMIN-0001",
    email: "admin@corporate.local",
  });

  await createUser({
    personId: person.id,
    roleId: adminRole.id,
    username: "admin",
    password,
  });

  logger.warn("Usuario de arranque 'admin' creado. Cambiar su password despues del primer login.");
}
