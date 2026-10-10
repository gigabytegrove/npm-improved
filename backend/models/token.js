/**
 NOTE: This is not a database table, this is a model of a Token object that can be created/loaded
 and then has abilities after that.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import _ from "lodash";
import { getPrivateKey, getPublicKey } from "../lib/config.js";
import { getClusterJwtKey } from "../lib/cluster-jwt.js";
import errs from "../lib/error.js";
import { global as logger } from "../logger.js";

const ALGO = "RS256";

export default () => {
	let tokenData = {};

	const self = {
		/**
		 * @param {Object}  payload
		 * @returns {Promise}
		 */
		create: (payload) => {
			// NPMX peers possess the same high-entropy pairing secret but NOT
			// one another's RSA private keys. New tokens use a scoped derived
			// key so both paired nodes can verify them.
			const clusterKey = getClusterJwtKey();
			const signingKey = clusterKey || getPrivateKey();
			if (!signingKey) {
				return Promise.reject(new errs.AuthError("JWT signing key is unavailable"));
			}
			const options = {
				algorithm: clusterKey ? "HS256" : ALGO,
				expiresIn: payload.expiresIn || "1d",
			};

			payload.jti = crypto.randomBytes(12).toString("base64").substring(-8);

			return new Promise((resolve, reject) => {
				jwt.sign(payload, signingKey, options, (err, token) => {
					if (err) {
						reject(err);
					} else {
						tokenData = payload;
						resolve({
							token: token,
							payload: payload,
						});
					}
				});
			});
		},

		/**
		 * @param {String} token
		 * @returns {Promise}
		 */
		load: (token) => {
			return new Promise((resolve, reject) => {
				try {
					if (!token || token === null || token === "null") {
						reject(new errs.AuthError("Empty token"));
					} else {
						// Explicitly whitelist the algorithm before selecting a key.
						// Never interpret an RSA public key as an HMAC secret.
						const header = jwt.decode(token, { complete: true })?.header;
						const key = header?.alg === "HS256"
							? getClusterJwtKey()
							: header?.alg === ALGO ? getPublicKey() : null;
						if (!key) {
							reject(new errs.AuthError("Invalid token signing key or algorithm"));
							return;
						}
						jwt.verify(
							token,
							key,
							{ ignoreExpiration: false, algorithms: [header.alg] },
							(err, result) => {
								if (err) {
									if (err.name === "TokenExpiredError") {
										reject(new errs.AuthError("Token has expired", err));
									} else {
										reject(err);
									}
								} else {
									tokenData = result;

									// Hack: some tokens out in the wild have a scope of 'all' instead of 'user'.
									// For 30 days at least, we need to replace 'all' with user.
									if (
										typeof tokenData.scope !== "undefined" &&
										_.indexOf(tokenData.scope, "all") !== -1
									) {
										tokenData.scope = ["user"];
									}

									resolve(tokenData);
								}
							},
						);
					}
				} catch (err) {
					reject(err);
				}
			});
		},

		/**
		 * Does the token have the specified scope?
		 *
		 * @param   {String}  scope
		 * @returns {Boolean}
		 */
		hasScope: (scope) => typeof tokenData.scope !== "undefined" && _.indexOf(tokenData.scope, scope) !== -1,

		/**
		 * @param  {String}  key
		 * @return {*}
		 */
		get: (key) => {
			if (typeof tokenData[key] !== "undefined") {
				return tokenData[key];
			}

			return null;
		},

		/**
		 * @param  {String}  key
		 * @param  {*}       value
		 */
		set: (key, value) => {
			tokenData[key] = value;
		},

		/**
		 * @param   [defaultValue]
		 * @returns {Integer}
		 */
		getUserId: (defaultValue) => {
			const attrs = self.get("attrs");
			if (attrs?.id) {
				return attrs.id;
			}

			return defaultValue || 0;
		},
	};

	return self;
};
