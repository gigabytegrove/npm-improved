import knex from "knex";
import { configGet, configHas } from "./lib/config.js";

let instance = null;

const generateDbConfigFor = (cfg) => {
	if (!cfg) {
		throw new Error("Database config does not exist");
	}

	if (cfg.engine === "knex-native") {
		return cfg.knex;
	}

	return {
		client: cfg.engine,
		connection: {
			host: cfg.host,
			user: cfg.user,
			password: cfg.password,
			database: cfg.name,
			port: cfg.port,
			...(cfg.ssl ? { ssl: cfg.ssl } : {}),
		},
		migrations: {
			tableName: "migrations",
		},
	};
};

const generateDbConfig = () => {
	if (!configHas("database")) {
		throw new Error(
			"Database config does not exist! Please read the instructions: https://nginxproxymanager.com/setup/",
		);
	}

	const cfg = configGet("database");
	return generateDbConfigFor(cfg);
};

const getInstance = () => {
	if (!instance) {
		instance = knex(generateDbConfig());
	}
	return instance;
};

export { generateDbConfigFor };
export default getInstance;
