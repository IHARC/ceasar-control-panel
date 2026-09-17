#!/bin/bash

set -eo pipefail
# Autocompile Script for Ceasar package Files.
# For building from this checkout use the "~localsrc" source selector.
# Compile but dont install -> ./ceasar_autocompile.sh --ceasar --noinstall --keepbuild '~localsrc'
# Compile and install -> ./ceasar_autocompile.sh --ceasar --install '~localsrc'

# Define download function
download_file() {
	local url=$1
	local destination=$2
	local force=$3
	local expected_sha256=$4

	if [ -z "$(which "wget")" ]; then
		echo "Installing wget..."
		apt-get -qq update > /dev/null
		apt-get -qq install -y wget
	fi

	[ "$CEASAR_DEBUG" ] && echo >&2 DEBUG: Downloading file "$url" to "$destination"

	# Default destination is the current working directory
	local dstopt=""

	if [ ! -z "$(echo "$url" | grep -E "\.(gz|gzip|bz2|zip|xz)$")" ]; then
		# When an archive file is downloaded it will be first saved localy
		dstopt="--directory-prefix=$ARCHIVE_DIR"
		local is_archive="true"
		local filename="${url##*/}"
		if [ -z "$filename" ]; then
			echo >&2 "[!] No filename was found in url, exiting ($url)"
			exit 1
		fi
		if [ ! -z "$force" ] && [ -f "$ARCHIVE_DIR/$filename" ]; then
			rm -f $ARCHIVE_DIR/$filename
		fi
	elif [ ! -z "$destination" ]; then
		# Plain files will be written to specified location
		dstopt="-O $destination"
	fi
	# Check for a corrupt or unexpected cached archive.
	if [ -f "$ARCHIVE_DIR/$filename" ] && [ "$is_archive" = "true" ]; then
		if [ -n "$expected_sha256" ] \
			&& ! printf '%s  %s\n' "$expected_sha256" "$ARCHIVE_DIR/$filename" | sha256sum --check --status; then
			echo >&2 "[!] Checksum mismatch for cached archive $filename"
			rm -f "$ARCHIVE_DIR/$filename"
		elif ! tar -tzf "$ARCHIVE_DIR/$filename" > /dev/null 2>&1; then
			echo >&2 "[!] Archive $ARCHIVE_DIR/$filename is corrupted, redownloading"
			rm -f "$ARCHIVE_DIR/$filename"
		fi
	fi

	if [ ! -f "$ARCHIVE_DIR/$filename" ]; then
		[ "$CEASAR_DEBUG" ] && echo >&2 DEBUG: wget $url -q $dstopt --show-progress --progress=bar:force --limit-rate=3m
		wget "$url" -q $dstopt --show-progress --progress=bar:force --limit-rate=3m
		if [ $? -ne 0 ]; then
			echo >&2 "[!] Archive $ARCHIVE_DIR/$filename is corrupted and exit script"
			rm -f $ARCHIVE_DIR/$filename
			exit 1
		fi
		if [ -n "$expected_sha256" ] \
			&& ! printf '%s  %s\n' "$expected_sha256" "$ARCHIVE_DIR/$filename" | sha256sum --check --status; then
			echo >&2 "[!] Checksum verification failed for $filename"
			rm -f "$ARCHIVE_DIR/$filename"
			exit 1
		fi
	fi

	if [ ! -z "$destination" ] && [ "$is_archive" = "true" ]; then
		if [ "$destination" = "-" ]; then
			cat "$ARCHIVE_DIR/$filename"
		elif [ -d "$(dirname $destination)" ]; then
			cp "$ARCHIVE_DIR/$filename" "$destination"
		fi
	fi
}

get_branch_file() {
	local filename=$1
	local destination=$2
	[ "$CEASAR_DEBUG" ] && echo >&2 DEBUG: Get branch file "$filename" to "$destination"
	if [ "$use_src_folder" == 'true' ]; then
		if [ -z "$destination" ]; then
			[ "$CEASAR_DEBUG" ] && echo >&2 DEBUG: cp -f "$SRC_DIR/$filename" ./
			cp -f "$SRC_DIR/$filename" ./
		else
			[ "$CEASAR_DEBUG" ] && echo >&2 DEBUG: cp -f "$SRC_DIR/$filename" "$destination"
			cp -f "$SRC_DIR/$filename" "$destination"
		fi
	else
		download_file "https://raw.githubusercontent.com/$REPO/$branch/$filename" "$destination" "$3"
	fi
	if [ -n "$destination" ] && [ "$destination" != '-' ] && [ -f "$destination" ]; then
		sed -i 's/\r$//' "$destination"
	fi
}

copy_local_source() {
	local destination=$1
	rm -rf "$destination"
	mkdir -p "$destination"
	tar -C "$SRC_DIR" \
		--exclude='./.git' \
		--exclude='./node_modules' \
		--exclude='*/node_modules' \
		--exclude='./dist' \
		-cf - . | tar -C "$destination" -xf -
}

usage() {
	echo "Usage:"
	echo "    $0 (--all|--ceasar|--nginx|--php|--web-terminal) [options] [branch] [Y]"
	echo ""
	echo "    --all           Build all ceasar packages."
	echo "    --ceasar        Build only the Control Panel package."
	echo "    --nginx         Build only the backend nginx engine package."
	echo "    --php           Build only the backend php engine package"
	echo "    --web-terminal  Build only the backend web terminal websocket package"
	echo "  Options:"
	echo "    --install       Install generated packages"
	echo "    --keepbuild     Don't delete downloaded source and build folders"
	echo "    --debug         Debug mode"
	echo "    --pkgrev <n>    Set the package revision number (default: 1)."
	echo "                    Replaces the '-1' in the version suffix"
	echo "                    (e.g. --pkgrev 2 → 1.0.12-2+ubuntu24.04)."
	echo "    --release <id>  Set a release identifier appended to the package version"
	echo "                    as '~<id>' (e.g. --release myci1 → 1.0.12-1+ubuntu24.04~myci1)."
	echo "                    Useful to distinguish custom or CI builds from official ones."
	echo "                    If the ceasar control file's Version already has a '~<tag>'"
	echo "                    suffix (e.g. 1.1.0~alpha) and --release is NOT given, that"
	echo "                    detected tag (e.g. 'alpha') is used automatically as the"
	echo "                    release identifier for ALL packages. If --release IS given,"
	echo "                    it overrides/replaces the detected '~<tag>' suffix instead."
	echo "                    Can be combined: --pkgrev 2 --release myci1 → 1.0.12-2+ubuntu24.04~myci1."
	echo ""
	echo "For automated builds and installations, you may specify the branch"
	echo "after one of the above flags. To install the packages, specify 'Y'"
	echo "following the branch name."
	echo ""
	echo "Example: bash ceasar_autocompile.sh --ceasar develop Y"
	echo "This would install a Ceasar Control Panel package compiled with the"
	echo "develop branch code."
	echo ""
	echo "Ceasar 1.0.12 builds only on Ubuntu 24.04 amd64."
}

get_distro_suffix() {
	local distro_id distro_num
	distro_id=$(lsb_release -is | tr '[:upper:]' '[:lower:]')
	distro_num=$(lsb_release -rs)

	if [ "$distro_id" = "ubuntu" ]; then
		echo "ubuntu${distro_num}"
	else
		echo "unknown"
	fi
}

apply_distro_version() {
	local control_file="$1"
	local distro_suffix="$2"
	if [ -z "$distro_suffix" ]; then
		distro_suffix=$(get_distro_suffix)
	fi

	local current_version
	current_version=$(grep "^Version:" "$control_file" | awk '{print $2}')

	# Strip any existing '~<tag>' pre-release suffix (e.g. ~alpha, ~beta, ~rc1) from the
	# base version before reconstructing it below. The tag itself (if present) was already
	# captured globally as BUILD_RELEASE (see BUILD_VER handling), unless the user passed
	# --release explicitly, in which case BUILD_RELEASE holds the user-specified value.
	local base_version="$current_version"
	if echo "$current_version" | grep -qE '~'; then
		base_version=$(echo "$current_version" | sed -E 's/~.*$//')
	fi

	# Build the release suffix:
	#   - Default pkgrev is 1; override with --pkgrev <n>
	#   - Without a release id : -<pkgrev>+<distro_suffix>                (e.g. -1+debian12)
	#   - With    a release id : -<pkgrev>+<distro_suffix>~<BUILD_RELEASE> (e.g. -1+debian12~myci1)
	# BUILD_RELEASE here may come from:
	#   1) the --release command line option (explicit user choice), or
	#   2) the '~<tag>' suffix auto-detected from the ceasar control file's Version,
	#      when --release was NOT specified (see detection right after BUILD_VER is read).
	local pkg_rev="${BUILD_PKG_REV:-1}"
	local release_suffix="-${pkg_rev}+${distro_suffix}"
	if [ -n "$BUILD_RELEASE" ]; then
		release_suffix="${release_suffix}~${BUILD_RELEASE}"
	fi

	sed -i "s/^Version: \(.*\)/Version: ${base_version}${release_suffix}/" "$control_file"
}

# Detects the package that provides a shared library required by ceasar-php
detect_pkg_from_elf() {
	local bin="$1"
	local lib_pattern="$2"

	local so_name
	so_name=$(readelf -d "$bin" 2> /dev/null \
		| awk '/NEEDED/ {gsub(/\[|\]/,"",$5); print $5}' \
		| grep "$lib_pattern" \
		| head -n1)

	[[ -z "$so_name" ]] && return 0

	# Try to resolve the real library path
	local so_path=""
	so_path=$(ldconfig -p 2> /dev/null \
		| awk -v lib="$so_name" '$1 == lib {print $NF; exit}')

	# Fallback if ldconfig does not return a result
	if [[ -z "$so_path" ]]; then
		so_path=$(find /lib /usr/lib -name "$so_name" 2> /dev/null | head -n1)
	fi

	[[ -z "$so_path" ]] && return 0

	# Use basename because dpkg-query expects only the file name, not the full path
	local pkg
	pkg=$(dpkg-query -S "$(basename "$so_path")" 2> /dev/null \
		| cut -d: -f1 \
		| head -n1)

	echo "$pkg"
}

# Set compiling directory
REPO='iharc-jordan/ceasar-control-panel'
BUILD_DIR="${BUILD_DIR:-/tmp/ceasar-src}"
INSTALL_DIR='/usr/local/ceasar'
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE_DIR="$BUILD_DIR/archive"
architecture="$(uname -m)"
BUILD_ARCH='amd64'

DEB_DIR="${DEB_DIR:-$BUILD_DIR/deb}"

# Set packages to compile
for i in $*; do
	case "$i" in
		--all)
			NGINX_B='true'
			PHP_B='true'
			WEB_TERMINAL_B='true'
			CEASAR_B='true'
			;;
		--nginx)
			NGINX_B='true'
			;;
		--php)
			PHP_B='true'
			;;
		--web-terminal)
			WEB_TERMINAL_B='true'
			;;
		--ceasar)
			CEASAR_B='true'
			;;
		--debug)
			CEASAR_DEBUG='true'
			;;
		--install | Y)
			install='true'
			;;
		--noinstall | N)
			install='false'
			;;
		--keepbuild)
			KEEPBUILD='true'
			;;
		--cross)
			echo "Cross builds are not supported. Ceasar 1.0.12 targets Ubuntu 24.04 amd64." >&2
			exit 1
			;;
		--help | -h)
			usage
			exit 1
			;;
		--dontinstalldeps)
			dontinstalldeps='true'
			;;
		--release)
			# Handled below via shift-style positional parsing; value captured next iteration
			_next_is_release='true'
			;;
		--pkgrev)
			# Handled below; value captured next iteration
			_next_is_pkgrev='true'
			;;
		*)
			if [ "$_next_is_release" = 'true' ]; then
				# Capture the value that follows --release
				BUILD_RELEASE="$i"
				RELEASE_EXPLICIT='true'
				unset _next_is_release
			elif [ "$_next_is_pkgrev" = 'true' ]; then
				# Capture the value that follows --pkgrev
				BUILD_PKG_REV="$i"
				unset _next_is_pkgrev
			else
				branch="$i"
			fi
			;;
	esac
done

if [[ $# -eq 0 ]]; then
	usage
	exit 1
fi

# Set command variables
if [ -z $branch ]; then
	echo -n "Please enter the name of the branch to build from (e.g. main): "
	read branch
fi

if echo "$branch" | grep -q '^~localsrc'; then
	branch=$(echo "$branch" | sed 's/^~//')
	use_src_folder='true'
else
	use_src_folder='false'
	if ! [[ "$branch" =~ ^[0-9a-f]{40}$ ]]; then
		echo "Remote builds require an exact 40-character Git commit. Use ~localsrc for this checkout." >&2
		exit 1
	fi
fi

platform_id="$(lsb_release -is 2> /dev/null | tr '[:upper:]' '[:lower:]')"
platform_release="$(lsb_release -rs 2> /dev/null)"
if [ "$platform_id" != 'ubuntu' ] || [ "$platform_release" != '24.04' ]; then
	echo "Ceasar 1.0.12 packages must be built on Ubuntu 24.04." >&2
	exit 1
fi
if [ "$architecture" != 'x86_64' ] && [ "$architecture" != 'amd64' ]; then
	echo "Ceasar 1.0.12 packages must be built for amd64." >&2
	exit 1
fi

if [ -z $install ]; then
	echo -n 'Would you like to install the compiled packages? [y/N] '
	read install
fi

# Set Version for compiling
if [ -f "$SRC_DIR/src/deb/ceasar/control" ] && [ "$use_src_folder" == 'true' ]; then
	BUILD_VER=$(grep "^Version:" "$SRC_DIR/src/deb/ceasar/control" | cut -d' ' -f2 | tr -d '\r')
	NGINX_V=$(grep "^Version:" "$SRC_DIR/src/deb/nginx/control" | cut -d' ' -f2 | tr -d '\r')
	PHP_V=$(grep "^Version:" "$SRC_DIR/src/deb/php/control" | cut -d' ' -f2 | tr -d '\r')
	WEB_TERMINAL_V=$(grep "^Version:" "$SRC_DIR/src/deb/web-terminal/control" | cut -d' ' -f2 | tr -d '\r')
else
	BUILD_VER=$(download_file https://raw.githubusercontent.com/$REPO/$branch/src/deb/ceasar/control | grep "Version:" | cut -d' ' -f2 | tr -d '\r')
	NGINX_V=$(download_file https://raw.githubusercontent.com/$REPO/$branch/src/deb/nginx/control | grep "Version:" | cut -d' ' -f2 | tr -d '\r')
	PHP_V=$(download_file https://raw.githubusercontent.com/$REPO/$branch/src/deb/php/control | grep "Version:" | cut -d' ' -f2 | tr -d '\r')
	WEB_TERMINAL_V=$(download_file https://raw.githubusercontent.com/$REPO/$branch/src/deb/web-terminal/control | grep "Version:" | cut -d' ' -f2 | tr -d '\r')
fi

if [ -z "$BUILD_VER" ]; then
	echo "Error: Branch invalid, could not detect version"
	exit 1
fi

# Auto-detect a '~<tag>' pre-release suffix (e.g. ~alpha, ~beta, ~rc1) from the ceasar
# control file's Version. If the user did NOT explicitly pass --release on the command
# line, this detected tag becomes BUILD_RELEASE and will be propagated to ALL packages
# (nginx, php, web-terminal, ceasar), even though those individual package versions
# don't carry the '~tag' themselves. If --release WAS explicitly given, it takes
# precedence and the detected tag is discarded (replaced) instead.
if echo "$BUILD_VER" | grep -qE '~'; then
	DETECTED_PRERELEASE_TAG=$(echo "$BUILD_VER" | sed -E 's/^[^~]*~//')
	if [ "$RELEASE_EXPLICIT" != 'true' ] && [ -n "$DETECTED_PRERELEASE_TAG" ]; then
		BUILD_RELEASE="$DETECTED_PRERELEASE_TAG"
	fi
fi

if [[ -n "$BUILD_RELEASE" ]]; then
	_build_release=" ($BUILD_RELEASE)"
fi
echo "Build version ${BUILD_VER}${_build_release}, with Nginx version $NGINX_V, PHP version $PHP_V and Web Terminal version $WEB_TERMINAL_V"

CEASAR_V="${BUILD_VER}_${BUILD_ARCH}"
# List of supported OS releases for Ceasar used for crossbuilding.
supported_os="ubuntu24.04"
OPENSSL_V='3.5.7'
PCRE_V='10.47'
ZLIB_V='1.3.2'

# Create build directories
if [ "$KEEPBUILD" != 'true' ]; then
	rm -rf $BUILD_DIR
fi
mkdir -p $BUILD_DIR
mkdir -p $DEB_DIR
mkdir -p $ARCHIVE_DIR

# Define a timestamp function
timestamp() {
	date +%s
}

if [ "$dontinstalldeps" != 'true' ]; then
	# Install needed software
	# Set package dependencies for compiling
	SOFTWARE='wget tar git curl ca-certificates build-essential libxml2-dev libz-dev libzip-dev libgmp-dev libcurl4-gnutls-dev unzip openssl libssl-dev pkg-config libsqlite3-dev libonig-dev lsb-release php-cli php-xml php-zip composer'
	echo "Updating system APT repositories..."
	apt-get -qq update
	echo "Installing dependencies for compilation..."
	apt-get -qq install -y $SOFTWARE

	# In a minimal/freshly-debootstrapped chroot, dpkg trigger processing
	# (which normally re-runs ldconfig after installing shared libs) can be
	# deferred or skipped, leaving the dynamic linker's cache stale even
	# though e.g. libzip.so.5 is genuinely on disk. Refresh it explicitly so
	# binaries built against these libs (php, nginx, ...) can actually run.
	ldconfig

	# Fix for Debian PHP environment
	if [ $BUILD_ARCH == "amd64" ]; then
		if [ ! -L /usr/local/include/curl ]; then
			ln -s /usr/include/x86_64-linux-gnu/curl /usr/local/include/curl
		fi
	fi
fi

if ! command -v node > /dev/null 2>&1 || ! command -v npm > /dev/null 2>&1; then
	echo "Node.js 22 or newer and npm are required to build Ceasar." >&2
	exit 1
fi
nodejs_version="$(node -p 'process.versions.node.split(`.`)[0]')"
if [ "$nodejs_version" -lt 22 ]; then
	echo "Node.js 22 or newer is required to build Ceasar." >&2
	exit 1
fi
if ! command -v composer > /dev/null 2>&1; then
	echo "Composer is required to vendor Ceasar PHP dependencies." >&2
	exit 1
fi

# Get system cpu cores. Callers running this inside a QEMU-emulated chroot
# (cross-arch builds) can pre-set NUM_CPUS to override this: /proc is
# bind-mounted from the host, so the detected count would otherwise be the
# host's real core count, not a safe parallelism level for emulated compiles.
NUM_CPUS="${NUM_CPUS:-$(nproc)}"

if [ "$CEASAR_DEBUG" ]; then
	echo "OS type          : Debian / Ubuntu"
	echo "Branch           : $branch"
	echo "Install          : $install"
	echo "Ceasar version   : $BUILD_VER"
	echo "Nginx version    : $NGINX_V"
	echo "PHP version      : $PHP_V"
	echo "Web Term version : $WEB_TERMINAL_V"
	echo "Architecture     : $BUILD_ARCH"
	echo "Debug mode       : $CEASAR_DEBUG"
	echo "Source directory : $SRC_DIR"
	echo "Build release    : $BUILD_RELEASE"
fi

# Generate Links for sourcecode
CEASAR_ARCHIVE_LINK='https://github.com/iharc-jordan/ceasar-control-panel/archive/'$branch'.tar.gz'
if [[ $NGINX_V =~ - ]]; then
	NGINX='https://nginx.org/download/nginx-'$(echo $NGINX_V | cut -d"-" -f1)'.tar.gz'
else
	NGINX='https://nginx.org/download/nginx-'$(echo $NGINX_V | cut -d"~" -f1)'.tar.gz'
fi

OPENSSL='https://github.com/openssl/openssl/releases/download/openssl-'$OPENSSL_V'/openssl-'$OPENSSL_V'.tar.gz'
PCRE='https://github.com/PCRE2Project/pcre2/releases/download/pcre2-'$PCRE_V'/pcre2-'$PCRE_V'.tar.gz'
ZLIB='https://github.com/madler/zlib/archive/refs/tags/v'$ZLIB_V'.tar.gz'

if [[ $PHP_V =~ - ]]; then
	PHP='http://de2.php.net/distributions/php-'$(echo $PHP_V | cut -d"-" -f1)'.tar.gz'
else
	PHP='https://www.php.net/distributions/php-'$(echo $PHP_V | cut -d"~" -f1)'.tar.gz'
fi

NGINX_SHA256="$(awk -v file="$(basename "$NGINX")" '$1 == file { print $2 }' "$SRC_DIR/src/sources.lock")"
OPENSSL_SHA256="$(awk -v file="$(basename "$OPENSSL")" '$1 == file { print $2 }' "$SRC_DIR/src/sources.lock")"
PCRE_SHA256="$(awk -v file="$(basename "$PCRE")" '$1 == file { print $2 }' "$SRC_DIR/src/sources.lock")"
ZLIB_SHA256="$(awk -v file="$(basename "$ZLIB")" '$1 == file { print $2 }' "$SRC_DIR/src/sources.lock")"
PHP_SHA256="$(awk -v file="$(basename "$PHP")" '$1 == file { print $2 }' "$SRC_DIR/src/sources.lock")"
for source_hash in "$NGINX_SHA256" "$OPENSSL_SHA256" "$PCRE_SHA256" "$ZLIB_SHA256" "$PHP_SHA256"; do
	if ! [[ "$source_hash" =~ ^[0-9a-f]{64}$ ]]; then
		echo "A compiler source is missing from src/sources.lock." >&2
		exit 1
	fi
done

# Forward slashes in branchname are replaced with dashes to match foldername in github archive.
branch_dash=$(echo "$branch" | sed 's/\//-/g')

#################################################################################
#
# Building ceasar-nginx
#
#################################################################################

if [ "$NGINX_B" = true ]; then

	echo "Building ceasar-nginx package..."
	if [ "$CROSS" = "true" ]; then
		echo "Cross compile not supported for ceasar-nginx, ceasar-php or ceasar-web-terminal"
		exit 1
	fi
	# Change to build directory
	cd $BUILD_DIR

	BUILD_DIR_CEASARNGINX=$BUILD_DIR/ceasar-nginx_$NGINX_V
	if [[ $NGINX_V =~ - ]]; then
		BUILD_DIR_NGINX=$BUILD_DIR/nginx-$(echo $NGINX_V | cut -d"-" -f1)
	else
		BUILD_DIR_NGINX=$BUILD_DIR/nginx-$(echo $NGINX_V | cut -d"~" -f1)
	fi

	if [ "$KEEPBUILD" != 'true' ] || [ ! -f "$BUILD_DIR_NGINX/Makefile" ]; then
		# Download and unpack source files
		download_file "$NGINX" '-' '' "$NGINX_SHA256" | tar xz
		download_file "$OPENSSL" '-' '' "$OPENSSL_SHA256" | tar xz
		download_file "$PCRE" '-' '' "$PCRE_SHA256" | tar xz
		download_file "$ZLIB" '-' '' "$ZLIB_SHA256" | tar xz

		# Change to nginx directory
		cd $BUILD_DIR_NGINX

		# configure nginx
		./configure --prefix=/usr/local/ceasar/nginx \
			--with-http_v2_module \
			--with-http_ssl_module \
			--with-openssl=../openssl-$OPENSSL_V \
			--with-openssl-opt=enable-ec_nistp_64_gcc_128 \
			--with-openssl-opt=no-nextprotoneg \
			--with-openssl-opt=no-weak-ssl-ciphers \
			--with-openssl-opt=no-ssl3 \
			--with-pcre=../pcre2-$PCRE_V \
			--with-pcre-jit \
			--with-zlib=../zlib-$ZLIB_V
	fi

	# Change to nginx directory
	cd $BUILD_DIR_NGINX

	# Check install directory and remove if exists
	if [ -d "$BUILD_DIR$INSTALL_DIR" ]; then
		rm -r "$BUILD_DIR$INSTALL_DIR"
	fi

	# Create the files and install them
	make -j $NUM_CPUS && make DESTDIR=$BUILD_DIR install

	# Clear up unused files
	if [ "$KEEPBUILD" != 'true' ]; then
		rm -r $BUILD_DIR_NGINX $BUILD_DIR/openssl-$OPENSSL_V $BUILD_DIR/pcre2-$PCRE_V $BUILD_DIR/zlib-$ZLIB_V
	fi
	rm -rf "$BUILD_DIR_CEASARNGINX"
	mkdir -p "$BUILD_DIR_CEASARNGINX"
	cd "$BUILD_DIR_CEASARNGINX"

	# Move nginx directory
	mkdir -p $BUILD_DIR_CEASARNGINX/usr/local/ceasar
	rm -rf $BUILD_DIR_CEASARNGINX/usr/local/ceasar/nginx
	mv $BUILD_DIR/usr/local/ceasar/nginx $BUILD_DIR_CEASARNGINX/usr/local/ceasar/

	# Remove original nginx.conf (will use custom)
	rm -f $BUILD_DIR_CEASARNGINX/usr/local/ceasar/nginx/conf/nginx.conf

	# copy binary
	mv $BUILD_DIR_CEASARNGINX/usr/local/ceasar/nginx/sbin/nginx $BUILD_DIR_CEASARNGINX/usr/local/ceasar/nginx/sbin/ceasar-nginx

	# change permission and build the package
	cd $BUILD_DIR
	chown -R root:root $BUILD_DIR_CEASARNGINX
	# Get Debian package files
	mkdir -p $BUILD_DIR_CEASARNGINX/DEBIAN
	get_branch_file 'src/deb/nginx/control' "$BUILD_DIR_CEASARNGINX/DEBIAN/control"
	if [ "$BUILD_ARCH" != "amd64" ]; then
		sed -i "s/amd64/${BUILD_ARCH}/g" "$BUILD_DIR_CEASARNGINX/DEBIAN/control"
	fi
	apply_distro_version "$BUILD_DIR_CEASARNGINX/DEBIAN/control"
	get_branch_file 'src/deb/nginx/copyright' "$BUILD_DIR_CEASARNGINX/DEBIAN/copyright"
	get_branch_file 'src/deb/nginx/postinst' "$BUILD_DIR_CEASARNGINX/DEBIAN/postinst"
	get_branch_file 'src/deb/nginx/postrm' "$BUILD_DIR_CEASARNGINX/DEBIAN/portrm"
	chmod +x "$BUILD_DIR_CEASARNGINX/DEBIAN/postinst"
	chmod +x "$BUILD_DIR_CEASARNGINX/DEBIAN/portrm"

	# Init file
	mkdir -p $BUILD_DIR_CEASARNGINX/etc/init.d
	get_branch_file 'src/deb/nginx/ceasar' "$BUILD_DIR_CEASARNGINX/etc/init.d/ceasar"
	chmod +x "$BUILD_DIR_CEASARNGINX/etc/init.d/ceasar"

	# Custom config
	get_branch_file 'src/deb/nginx/nginx.conf' "${BUILD_DIR_CEASARNGINX}/usr/local/ceasar/nginx/conf/nginx.conf"

	# Build the package
	echo Building Nginx DEB
	dpkg-deb -Zxz --build $BUILD_DIR_CEASARNGINX $DEB_DIR

	rm -r $BUILD_DIR/usr

	if [ "$KEEPBUILD" != 'true' ]; then
		# Clean up the source folder
		rm -rf "$BUILD_DIR_NGINX"
		rm -rf $BUILD_DIR/rpmbuild
		if [ "$use_src_folder" == 'true' ] && [ -d $BUILD_DIR/ceasar-$branch_dash ]; then
			rm -r $BUILD_DIR/ceasar-$branch_dash
		fi
	fi
fi

#################################################################################
#
# Building ceasar-php
#
#################################################################################

if [ "$PHP_B" = true ]; then
	echo "Building ceasar-php package..."
	if [ "$CROSS" = "true" ]; then
		echo "Cross compile not supported for ceasar-nginx, ceasar-php or ceasar-web-terminal"
		exit 1
	fi

	BUILD_DIR_CEASARPHP=$BUILD_DIR/ceasar-php_$PHP_V

	BUILD_DIR_PHP=$BUILD_DIR/php-$(echo $PHP_V | cut -d"~" -f1)

	if [[ $PHP_V =~ - ]]; then
		BUILD_DIR_PHP=$BUILD_DIR/php-$(echo $PHP_V | cut -d"-" -f1)
	else
		BUILD_DIR_PHP=$BUILD_DIR/php-$(echo $PHP_V | cut -d"~" -f1)
	fi

	if [ "$KEEPBUILD" != 'true' ] || [ ! -f "$BUILD_DIR_PHP/Makefile" ]; then
		# Download and unpack source files
		cd $BUILD_DIR
		download_file "$PHP" '-' '' "$PHP_SHA256" | tar xz

		# Change to untarred php directory
		cd $BUILD_DIR_PHP

		# Configure PHP
		./configure --prefix=/usr/local/ceasar/php \
			--with-libdir=lib/$(arch)-linux-gnu \
			--enable-fpm --with-fpm-user=admin --with-fpm-group=admin \
			--with-openssl \
			--with-mysqli \
			--with-gettext \
			--with-curl \
			--with-zip \
			--with-gmp \
			--enable-mbstring
	fi

	cd $BUILD_DIR_PHP

	# Create the files and install them
	make -j $NUM_CPUS && make INSTALL_ROOT=$BUILD_DIR install
	rm -rf "$BUILD_DIR_CEASARPHP"

	# Move php directory
	[ "$CEASAR_DEBUG" ] && echo DEBUG: mkdir -p $BUILD_DIR_CEASARPHP/usr/local/ceasar
	mkdir -p $BUILD_DIR_CEASARPHP/usr/local/ceasar

	[ "$CEASAR_DEBUG" ] && echo DEBUG: mv ${BUILD_DIR}/usr/local/ceasar/php ${BUILD_DIR_CEASARPHP}/usr/local/ceasar/
	mv ${BUILD_DIR}/usr/local/ceasar/php ${BUILD_DIR_CEASARPHP}/usr/local/ceasar/

	# copy binary
	[ "$CEASAR_DEBUG" ] && echo DEBUG: cp $BUILD_DIR_CEASARPHP/usr/local/ceasar/php/sbin/php-fpm $BUILD_DIR_CEASARPHP/usr/local/ceasar/php/sbin/ceasar-php
	cp $BUILD_DIR_CEASARPHP/usr/local/ceasar/php/sbin/php-fpm $BUILD_DIR_CEASARPHP/usr/local/ceasar/php/sbin/ceasar-php

	# Change permissions and build the package
	chown -R root:root $BUILD_DIR_CEASARPHP
	# Get Debian package files
	[ "$CEASAR_DEBUG" ] && echo DEBUG: mkdir -p $BUILD_DIR_CEASARPHP/DEBIAN
	mkdir -p $BUILD_DIR_CEASARPHP/DEBIAN
	get_branch_file 'src/deb/php/control' "$BUILD_DIR_CEASARPHP/DEBIAN/control"
	if [ "$BUILD_ARCH" != "amd64" ]; then
		sed -i "s/amd64/${BUILD_ARCH}/g" "$BUILD_DIR_CEASARPHP/DEBIAN/control"
	fi
	apply_distro_version "$BUILD_DIR_CEASARPHP/DEBIAN/control"

	# Extract correct libs as depends
	PHP_BIN="$BUILD_DIR_CEASARPHP/usr/local/ceasar/php/sbin/ceasar-php"
	LIBZIP_DEP=$(detect_pkg_from_elf "$PHP_BIN" "libzip")
	ONIG_DEP=$(detect_pkg_from_elf "$PHP_BIN" "libonig")
	sed -i \
		-e "s/@LIBZIP_DEP@/${LIBZIP_DEP}/g" \
		-e "s/@ONIG_DEP@/${ONIG_DEP}/g" \
		"$BUILD_DIR_CEASARPHP/DEBIAN/control"

	get_branch_file 'src/deb/php/copyright' "$BUILD_DIR_CEASARPHP/DEBIAN/copyright"
	get_branch_file 'src/deb/php/postinst' "$BUILD_DIR_CEASARPHP/DEBIAN/postinst"
	chmod +x $BUILD_DIR_CEASARPHP/DEBIAN/postinst
	# Get custom config
	get_branch_file 'src/deb/php/php-fpm.conf' "${BUILD_DIR_CEASARPHP}/usr/local/ceasar/php/etc/php-fpm.conf"
	get_branch_file 'src/deb/php/php.ini' "${BUILD_DIR_CEASARPHP}/usr/local/ceasar/php/lib/php.ini"

	# Build the package
	echo Building PHP DEB
	[ "$CEASAR_DEBUG" ] && echo DEBUG: dpkg-deb -Zxz --build $BUILD_DIR_CEASARPHP $DEB_DIR
	dpkg-deb -Zxz --build $BUILD_DIR_CEASARPHP $DEB_DIR

	rm -r $BUILD_DIR/usr

	# clear up the source folder
	if [ "$KEEPBUILD" != 'true' ]; then
		rm -r $BUILD_DIR/php-$(echo $PHP_V | cut -d"~" -f1)
		rm -r $BUILD_DIR_CEASARPHP
		if [ "$use_src_folder" == 'true' ] && [ -d $BUILD_DIR/ceasar-$branch_dash ]; then
			rm -r $BUILD_DIR/ceasar-$branch_dash
		fi
	fi
fi

#################################################################################
#
# Building ceasar-web-terminal
#
#################################################################################

if [ "$WEB_TERMINAL_B" = true ]; then
	echo "Building ceasar-web-terminal package..."
	if [ "$CROSS" = "true" ]; then
		echo "Cross compile not supported for ceasar-nginx, ceasar-php or ceasar-web-terminal"
		exit 1
	fi

	BUILD_DIR_CEASAR_TERMINAL=$BUILD_DIR/ceasar-web-terminal_$WEB_TERMINAL_V

	# Check if target directory exist
	if [ -d $BUILD_DIR_CEASAR_TERMINAL ]; then
		rm -r $BUILD_DIR_CEASAR_TERMINAL
	fi

	# Create directory
	mkdir -p $BUILD_DIR_CEASAR_TERMINAL
	chown -R root:root $BUILD_DIR_CEASAR_TERMINAL

	# Get Debian package files
	[ "$CEASAR_DEBUG" ] && echo DEBUG: mkdir -p $BUILD_DIR_CEASAR_TERMINAL/DEBIAN
	mkdir -p $BUILD_DIR_CEASAR_TERMINAL/DEBIAN
	get_branch_file 'src/deb/web-terminal/control' "$BUILD_DIR_CEASAR_TERMINAL/DEBIAN/control"
	if [ "$BUILD_ARCH" != "amd64" ]; then
		sed -i "s/amd64/${BUILD_ARCH}/g" "$BUILD_DIR_CEASAR_TERMINAL/DEBIAN/control"
	fi
	apply_distro_version "$BUILD_DIR_CEASAR_TERMINAL/DEBIAN/control"
	get_branch_file 'src/deb/web-terminal/copyright' "$BUILD_DIR_CEASAR_TERMINAL/DEBIAN/copyright"
	get_branch_file 'src/deb/web-terminal/postinst' "$BUILD_DIR_CEASAR_TERMINAL/DEBIAN/postinst"
	chmod +x $BUILD_DIR_CEASAR_TERMINAL/DEBIAN/postinst

	# Get server files
	[ "$CEASAR_DEBUG" ] && echo DEBUG: mkdir -p "${BUILD_DIR_CEASAR_TERMINAL}/usr/local/ceasar/web-terminal"
	mkdir -p "${BUILD_DIR_CEASAR_TERMINAL}/usr/local/ceasar/web-terminal"
	get_branch_file 'src/deb/web-terminal/package.json' "${BUILD_DIR_CEASAR_TERMINAL}/usr/local/ceasar/web-terminal/package.json"
	get_branch_file 'src/deb/web-terminal/package-lock.json' "${BUILD_DIR_CEASAR_TERMINAL}/usr/local/ceasar/web-terminal/package-lock.json"
	get_branch_file 'src/deb/web-terminal/server.js' "${BUILD_DIR_CEASAR_TERMINAL}/usr/local/ceasar/web-terminal/server.js"
	get_branch_file 'src/deb/web-terminal/web-terminal-session-auth.php' "${BUILD_DIR_CEASAR_TERMINAL}/usr/local/ceasar/web-terminal/web-terminal-session-auth.php"
	chmod +x "${BUILD_DIR_CEASAR_TERMINAL}/usr/local/ceasar/web-terminal/server.js"
	chmod +x "${BUILD_DIR_CEASAR_TERMINAL}/usr/local/ceasar/web-terminal/web-terminal-session-auth.php"

	cd $BUILD_DIR_CEASAR_TERMINAL/usr/local/ceasar/web-terminal
	npm ci --omit=dev

	# Systemd service
	[ "$CEASAR_DEBUG" ] && echo DEBUG: mkdir -p $BUILD_DIR_CEASAR_TERMINAL/etc/systemd/system
	mkdir -p $BUILD_DIR_CEASAR_TERMINAL/etc/systemd/system
	get_branch_file 'src/deb/web-terminal/ceasar-web-terminal.service' "$BUILD_DIR_CEASAR_TERMINAL/etc/systemd/system/ceasar-web-terminal.service"

	# Build the package
	echo Building Web Terminal DEB
	[ "$CEASAR_DEBUG" ] && echo DEBUG: dpkg-deb -Zxz --build $BUILD_DIR_CEASAR_TERMINAL $DEB_DIR
	dpkg-deb -Zxz --build $BUILD_DIR_CEASAR_TERMINAL $DEB_DIR

	# clear up the source folder
	if [ "$KEEPBUILD" != 'true' ]; then
		rm -r $BUILD_DIR_CEASAR_TERMINAL
		if [ "$use_src_folder" == 'true' ] && [ -d $BUILD_DIR/ceasar-$branch_dash ]; then
			rm -r $BUILD_DIR/ceasar-$branch_dash
		fi
	fi
fi

#################################################################################
#
# Building ceasar
#
#################################################################################

arch="$BUILD_ARCH"

if [ "$CEASAR_B" = true ]; then
	arch="$BUILD_ARCH"
	supported_os=$(get_distro_suffix)

	echo "Building Ceasar Control Panel package..."

	BUILD_DIR_CEASAR=$BUILD_DIR/ceasar_$CEASAR_V

	# Change to build directory
	cd $BUILD_DIR

	# Package staging must be clean even when compiler source caches are kept.
	rm -rf "$BUILD_DIR_CEASAR"
	mkdir -p "$BUILD_DIR_CEASAR"

	cd $BUILD_DIR
	rm -rf $BUILD_DIR/ceasar-$branch_dash
	# Download and unpack source files
	if [ "$use_src_folder" == 'true' ]; then
		[ "$CEASAR_DEBUG" ] && echo DEBUG: copying local source to "$BUILD_DIR/ceasar-$branch_dash"
		copy_local_source "$BUILD_DIR/ceasar-$branch_dash"
	elif [ -d $SRC_DIR ]; then
		download_file $CEASAR_ARCHIVE_LINK '-' 'fresh' | tar xz
	fi
	find "$BUILD_DIR/ceasar-$branch_dash" -type f \
		\( -path '*/bin/*' -o -path '*/func/*' -o -name '*.sh' -o -name '*.php' \
		-o -name 'control' -o -name 'preinst' -o -name 'postinst' -o -name 'postrm' \) \
		-exec sed -i 's/\r$//' {} +

	mkdir -p $BUILD_DIR_CEASAR/usr/local/ceasar

	# Build web and move needed directories
	cd $BUILD_DIR/ceasar-$branch_dash
	npm ci --ignore-scripts
	npm run build
	composer install --working-dir=web/inc --no-dev --no-interaction --no-progress --prefer-dist --classmap-authoritative --ignore-platform-req=php
	composer install --working-dir=web/src --no-dev --no-interaction --no-progress --prefer-dist --classmap-authoritative --ignore-platform-req=php
	filemanager_build="$(mktemp -d)"
	unzip -qq vendor/filegator/filegator_v7.15.1.zip -d "$filemanager_build"
	cp -a install/deb/filemanager/filegator/. "$filemanager_build/filegator/"
	composer install --working-dir="$filemanager_build/filegator" --no-dev --no-interaction --no-progress --prefer-dist --classmap-authoritative --ignore-platform-req=php
	rm -rf install/deb/filemanager/filegator/vendor
	cp -a "$filemanager_build/filegator/vendor" install/deb/filemanager/filegator/vendor
	rm -rf "$filemanager_build"
	php -r "require 'web/inc/vendor/autoload.php'; exit(function_exists('Ceasar\\\\Shell\\\\quoteshellarg') ? 0 : 1);"
	php -r "require 'web/src/vendor/autoload.php'; exit(class_exists('Ceasar\\\\System\\\\CeasarApp') ? 0 : 1);"
	for BUILD_ARCH in $arch; do
		for os in $supported_os; do
			mkdir -p $BUILD_DIR_CEASAR/usr/local/ceasar
			cp -rf bin func install libexec vendor web LICENSE UPSTREAM_NOTICES.md $BUILD_DIR_CEASAR/usr/local/ceasar/
			mkdir -p "$BUILD_DIR_CEASAR/usr/local/ceasar/share"
			build_commit="${GITHUB_SHA:-$(git -C "$SRC_DIR" rev-parse HEAD)}"
			if ! [[ "$build_commit" =~ ^[0-9a-f]{40}$ ]]; then
				echo "Unable to determine the exact 40-character source commit." >&2
				exit 1
			fi
			printf '{\n  "schema": 1,\n  "version": "%s",\n  "commit": "%s",\n  "platform": "ubuntu24.04",\n  "architecture": "amd64"\n}\n' \
				"${BUILD_VER%%~*}" "$build_commit" > "$BUILD_DIR_CEASAR/usr/local/ceasar/share/build-info.json"

			# Set permissions
			find $BUILD_DIR_CEASAR/usr/local/ceasar/ -type f -exec chmod -x {} \;

			# Allow send email via /usr/local/ceasar/web/inc/mail-wrapper.php via cli
			chmod +x $BUILD_DIR_CEASAR/usr/local/ceasar/web/inc/mail-wrapper.php
			# Allow the executable to be executed
			chmod +x $BUILD_DIR_CEASAR/usr/local/ceasar/bin/*
			find $BUILD_DIR_CEASAR/usr/local/ceasar/libexec -type f -exec chmod +x {} \;
			find $BUILD_DIR_CEASAR/usr/local/ceasar/install/ \( -name '*.sh' \) -exec chmod +x {} \;
			chmod -x $BUILD_DIR_CEASAR/usr/local/ceasar/install/*.sh
			chown -R root:root $BUILD_DIR_CEASAR
			# Get Debian package files
			mkdir -p $BUILD_DIR_CEASAR/DEBIAN
			get_branch_file 'src/deb/ceasar/control' "$BUILD_DIR_CEASAR/DEBIAN/control"
			if [ "$BUILD_ARCH" != "amd64" ]; then
				sed -i "s/amd64/${BUILD_ARCH}/g" "$BUILD_DIR_CEASAR/DEBIAN/control"
			fi
			apply_distro_version "$BUILD_DIR_CEASAR/DEBIAN/control" "$os"
			get_branch_file 'src/deb/ceasar/copyright' "$BUILD_DIR_CEASAR/DEBIAN/copyright"
			get_branch_file 'src/deb/ceasar/preinst' "$BUILD_DIR_CEASAR/DEBIAN/preinst"
			get_branch_file 'src/deb/ceasar/postinst' "$BUILD_DIR_CEASAR/DEBIAN/postinst"
			chmod +x $BUILD_DIR_CEASAR/DEBIAN/postinst
			chmod +x $BUILD_DIR_CEASAR/DEBIAN/preinst

			echo Building Ceasar DEB
			dpkg-deb -Zxz --build $BUILD_DIR_CEASAR $DEB_DIR

			# clear up the source folder
			if [ "$KEEPBUILD" != 'true' ]; then
				rm -r $BUILD_DIR_CEASAR
				rm -rf ceasar-$branch_dash
			fi
			cd $BUILD_DIR/ceasar-$branch_dash
		done
	done
fi

#################################################################################
#
# Install Packages
#
#################################################################################

if [ "$install" = 'yes' ] || [ "$install" = 'y' ] || [ "$install" = 'true' ]; then
	# Install all available packages
	echo "Installing packages..."
	for i in $DEB_DIR/*.deb; do
		dpkg -i $i
		if [ $? -ne 0 ]; then
			exit 1
		fi
	done
	unset $answer
fi
