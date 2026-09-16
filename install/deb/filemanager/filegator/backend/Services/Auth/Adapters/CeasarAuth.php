<?php

/*
 * This file is part of the FileGator package.
 *
 * (c) Milos Stojanovic <alcalbg@gmail.com>
 *
 * For the full copyright and license information, please view the LICENSE file
 */

namespace Filegator\Services\Auth\Adapters;

use Filegator\Services\Auth\AuthInterface;
use Filegator\Services\Auth\User;
use Filegator\Services\Auth\UsersCollection;
use Filegator\Services\Service;
use function Ceasar\Shell\quoteshellarg;

/**
 * @codeCoverageIgnore
 */
class CeasarAuth implements Service, AuthInterface {
	protected $permissions = [];

	protected $private_repos = false;

	protected $ceasar_user = "";

	public function init(array $config = []) {
		if (isset($_SESSION["user"])) {
			$v_user = $_SESSION["user"];
		}
		if (!empty($_SESSION["look"])) {
			if (isset($_SESSION["look"]) && $_SESSION["userContext"] === "admin") {
				$v_user = $_SESSION["look"];
			}
			if (
				$_SESSION["look"] == $_SESSION["ROOT_USER"] &&
				$_SESSION["POLICY_SYSTEM_PROTECTED_ADMIN"] == "yes"
			) {
				// Go away do not login
				header("Location: /");
				exit();
			}
		}
		$this->ceasar_user = $v_user;
		$this->permissions = isset($config["permissions"]) ? (array) $config["permissions"] : [];
		$this->private_repos = isset($config["private_repos"])
			? (bool) $config["private_repos"]
			: false;
	}

	public function user(): ?User {
		$cmd = "/usr/bin/sudo /usr/local/ceasar/bin/v-list-user";
		exec($cmd . " " . quoteshellarg($this->ceasar_user) . " json", $output, $return_var);

		if ($return_var == 0) {
			$data = json_decode(implode("", $output), true);
			$ceasar_user_info = $data[$this->ceasar_user];
			return $this->transformUser($ceasar_user_info);
		}

		return $this->getGuest();
	}

	public function transformUser($hstuser): User {
		$user = new User();
		$user->setUsername($this->ceasar_user);
		$user->setName($this->ceasar_user . " (" . $hstuser["NAME"] . ")");
		$user->setRole("user");
		$user->setPermissions($this->permissions);
		$user->setHomedir("/");
		return $user;
	}

	public function authenticate($username, $password): bool {
		# Auth is handled by Ceasar
		return false;
	}

	public function forget() {
		// Logout return to Ceasar
		return $this->getGuest();
	}

	public function store(User $user) {
		return null; // not used
	}

	public function update($username, User $user, $password = ""): User {
		// Password change is handled by Ceasar
		return $this->user();
	}

	public function add(User $user, $password): User {
		return new User(); // not used
	}

	public function delete(User $user) {
		return true; // not used
	}

	public function find($username): ?User {
		return null; // not used
	}

	public function allUsers(): UsersCollection {
		return new UsersCollection(); // not used
	}

	public function getGuest(): User {
		$guest = new User();

		$guest->setUsername("guest");
		$guest->setName("Guest");
		$guest->setRole("guest");
		$guest->setHomedir("/");
		$guest->setPermissions([]);

		return $guest;
	}
}
