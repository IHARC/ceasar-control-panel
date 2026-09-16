<?php

declare(strict_types=1);

namespace Ceasar\Shell;

/**
 * Quote one scalar as a single shell argument without locale-dependent UTF-8 loss.
 *
 * Derived from hestiacp/phpquoteshellarg 1.1.0 at commit
 * 3499670c48aed5f04f2656e9cd06d6e2709e8e08. The upstream source is dedicated
 * to the public domain under the Unlicense; see LICENSE.
 */
function quoteshellarg(string|int|float $arg): string {
	if (is_float($arg)) {
		return escapeshellarg(sprintf("%.17g", $arg));
	}
	if (is_int($arg)) {
		return escapeshellarg((string) $arg);
	}

	static $isUnix = null;
	if ($isUnix === null) {
		$isUnix =
			in_array(PHP_OS_FAMILY, ["Linux", "BSD", "Darwin", "Solaris"], true) ||
			PHP_OS === "CYGWIN";
	}
	if (!$isUnix) {
		return escapeshellarg($arg);
	}
	if (str_contains($arg, "\0")) {
		throw new \UnexpectedValueException("Shell arguments cannot contain null bytes.");
	}

	return "'" . strtr($arg, ["'" => "'\\''"]) . "'";
}
