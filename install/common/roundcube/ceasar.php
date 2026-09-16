<?php

/**
 * Ceasar Control Panel Password Driver
 *
 * @version 1.0
 * @author Ceasar <info@ceasar.com>
 */
class rcube_ceasar_password {
	public function save($curpass, $passwd) {
		$rcmail = rcmail::get_instance();
		$ceasar_host = $rcmail->config->get("password_ceasar_host");

		if (empty($ceasar_host)) {
			$ceasar_host = "localhost";
		}

		$ceasar_port = $rcmail->config->get("password_ceasar_port");
		if (empty($ceasar_port)) {
			$ceasar_port = "8083";
		}

		$postvars = [
			"email" => $_SESSION["username"],
			"password" => $curpass,
			"new" => $passwd,
		];
		$url = "https://{$ceasar_host}:{$ceasar_port}/reset/mail/";
		$ch = curl_init();
		if (
			false ===
			curl_setopt_array($ch, [
				CURLOPT_URL => $url,
				CURLOPT_RETURNTRANSFER => true,
				CURLOPT_HEADER => true,
				CURLOPT_POST => true,
				CURLOPT_POSTFIELDS => http_build_query($postvars),
				CURLOPT_USERAGENT => "Ceasar Control Panel Password Driver",
				CURLOPT_SSL_VERIFYPEER => false,
				CURLOPT_SSL_VERIFYHOST => false,
			])
		) {
			// should never happen
			throw new Exception("curl_setopt_array() failed: " . curl_error($ch));
		}
		$result = curl_exec($ch);
		if (curl_errno($ch) !== CURLE_OK) {
			throw new Exception("curl_exec() failed: " . curl_error($ch));
		}
		curl_close($ch);
		if (strpos($result, "ok") && !strpos($result, "error")) {
			return PASSWORD_SUCCESS;
		} else {
			return PASSWORD_ERROR;
		}
	}
}
