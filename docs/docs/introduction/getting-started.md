# Getting Started

This section describes how to review a Ceasar Control Panel installation on your server. If you already have a compatible installation and are just looking for options, you can skip this page.

::: warning
The installer needs to be run as **root**, either directly from the terminal or remotely, using SSH. If you do not do this, the installer will not proceed.
:::

## Requirements

::: warning
Ceasar Control Panel must be installed on top of a fresh operating system installation to ensure proper functionality.
See custom installation below for further details.
:::

|                      | Minimum                                             | Recommended                        |
| -------------------- | --------------------------------------------------- | ---------------------------------- |
| **CPU**              | 1 core, 64-bit                                      | 4 cores                            |
| **Memory**           | 1 GB (no SpamAssassin and ClamAV)                   | 4 GB                               |
| **Disk**             | 10 GB HDD                                           | 40 GB SSD                          |
| **Operating System** | Debian 11, 12, 13<br>Ubuntu 22.04, 24.04, 26.04 LTS | Latest Debian<br>Latest Ubuntu LTS |

::: warning
Ceasar Control Panel only runs on AMD64 / x86_64 and ARM64 / aarch64 processors. It also requires a 64bit operating system!
We currently do not support i386 or ARM7-based processors.
:::

### Supported operating systems

- Debian 11, 12 or 13
- Ubuntu 22.04, 24.04 or 26.04

::: warning
The installer does not support non-LTS operating systems. This source checkout does not publish a support service.
:::

## Regular installation

Interactive installer that installs the default Ceasar Control Panel software configuration.

### Step 1: Download

Clone the reviewed source checkout. This repository does not publish a release installer:

```bash
git clone https://github.com/IHARC/ceasar-control-panel.git ceasar-control-panel
cd ceasar-control-panel
```

If the download fails due to an SSL validation error, please be sure you've installed the ca-certificate package on your system - you can do this with the following command:

```bash
apt-get update && apt-get install ca-certificates
```

### Step 2: Run

To begin the installation process, simply run the script and follow the on-screen prompts:

```bash
bash ceasar-install.sh
```

You will receive a welcome email at the address specified during installation (if applicable) and on-screen instructions after the installation is completed to log in and access your server.

## Custom installation

If you want to customise which software gets installed, or want to run an unattended installation, you will need to run a custom installation.

To view a list of available options, run

```bash
bash ceasar-install.sh -h
```

### List of installation options

::: tip
An easier way to choose your installation options is by using the [Install script generator](/install).
:::

To choose what software gets installed, you can provide flags to the installation script. You can view the full list of options below.

```bash
-a, --apache Install Apache [yes | no] default: yes
-w, --phpfpm Install PHP-FPM [yes | no] default: yes
-o, --multiphp Install MultiPHP [yes | no] default: no
-v, --vsftpd Install VSFTPD [yes | no] default: yes
-j, --proftpd Install ProFTPD [yes | no] default: no
-k, --named Install BIND [yes | no] default: yes
-m, --mysql Install MariaDB [yes | no] default: yes
-M, --mysql8 Install MySQL 8 [yes | no] default: no
-g, --postgresql Install PostgreSQL [yes | no] default: no
-x, --exim Install Exim [yes | no] default: yes
-z, --dovecot Install Dovecot [yes | no] default: yes
-Z, --sieve Install Sieve [yes | no] default: no
-c, --clamav Install ClamAV [yes | no] default: yes
-t, --spamassassin Install SpamAssassin [yes | no] default: yes
-i, --iptables Install iptables [yes | no] default: yes
-b, --fail2ban Install Fail2Ban [yes | no] default: yes
-q, --quota Filesystem Quota [yes | no] default: no
-W, --webterminal Web Terminal [yes | no] default: no
-d, --api Activate API [yes | no] default: yes
-r, --port Change Backend Port default: 8083
-l, --lang Default language default: en
-y, --interactive Interactive install [yes | no] default: yes
-s, --hostname Set hostname
-e, --email Set admin email
-u, --username Set admin user
-p, --password Set admin password
-D, --packages Path to the directory containing the four Ceasar debs
--non-interactive Run without interactive prompts
--managed-profile Validated managed-hosting JSON profile
-f, --force Force installation
-h, --help Print this help
```

:::tip
Option --multiphp (Multi PHP) also accepts a comma separated list of PHP versions. For example: --multiphp 8.3,8.4 will install PHP8.3 and PHP8.4
:::

#### Example

```bash
bash ceasar-install.sh \
	--interactive no \
	--hostname host.domain.tld \
	--email email@domain.tld \
	--password p4ssw0rd \
	--lang fr \
	--apache no \
	--named no \
	--clamav no \
	--spamassassin no \
	--multiphp '8.2,8.3,8.4'
```

This command will install Ceasar Control Panel in French with the following software:

- Nginx Web Server
- PHP-FPM Application Server (PHP version 8.2, 8.3 and 8.4)
- MariaDB Database Server
- IPtables Firewall + Fail2Ban Intrusion prevention software
- Vsftpd FTP Server
- Exim Mail Server
- Dovecot POP3/IMAP Server

## What’s next?

After a separately reviewed installation, you can add users and websites through the panel.

To access your control panel, navigate to `https://host.domain.tld:8083` or `http://your.public.ip.address:8083`
