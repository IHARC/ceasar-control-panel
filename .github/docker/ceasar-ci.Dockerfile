FROM ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254

ARG NODEJS_DEB_VERSION=22.23.2-1nodesource1
ENV DEBIAN_FRONTEND=noninteractive
ENV container=docker

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		curl \
		eatmydata \
		gnupg \
	&& EATMYDATA_SO="$(ldconfig -p | awk '/libeatmydata.so/{print $NF; exit}')" \
	&& [ -n "${EATMYDATA_SO}" ] \
	&& echo "${EATMYDATA_SO}" > /etc/ld.so.preload \
	&& install -d -m 0755 /etc/apt/keyrings \
	&& curl --fail --silent --show-error --location \
		https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
	| gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
	&& echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
		> /etc/apt/sources.list.d/nodesource.list \
	&& apt-get update \
	&& apt-get full-upgrade -y \
	&& apt-get install -y --no-install-recommends \
		apt-utils \
		apt-transport-https \
		ca-certificates \
		curl \
		dbus \
		fail2ban \
		git \
		gnupg \
		htop \
		iproute2 \
		iptables \
		jq \
		less \
		locales \
		lsb-release \
		nano \
		netcat-openbsd \
		netplan.io \
		net-tools \
		"nodejs=${NODEJS_DEB_VERSION}" \
		rsync \
		software-properties-common \
		sudo \
		systemd \
		systemd-sysv \
		systemd-timesyncd \
		tzdata \
		vim \
		wget \
	&& node_version="$(node --version)" \
	&& test "${node_version%%.*}" = 'v22' \
	&& rm -rf /var/lib/apt/lists/*

RUN locale-gen en_US.UTF-8 \
	&& update-locale LANG=en_US.UTF-8

# Ensure sshd privilege separation dir exists at boot on /run tmpfs.
RUN printf 'd /run/sshd 0755 root root -\n' > /etc/tmpfiles.d/sshd.conf

# Avoid ssh.service entering start-limit-hit during rapid restart loops in tests.
RUN mkdir -p /etc/systemd/system/ssh.service.d
COPY .github/docker/files/ssh.service.10-docker.conf /etc/systemd/system/ssh.service.d/10-docker.conf

# Ensure netplan exists in Ubuntu containers so v-add-sys-ip uses netplan path in tests.
COPY .github/docker/files/netplan.01-docker.yaml /etc/netplan/01-docker.yaml

# netplan.io's systemd generator auto-starts networkd/resolved at boot just because a
# renderer: networkd config exists, which fights Docker's own --dns-based /etc/resolv.conf
# and breaks DNS entirely. Mask both so netplan stays usable as a CLI/config for
# v-add-sys-ip (bin/v-add-sys-ip) without ever taking over live networking in the container.
RUN systemctl mask systemd-networkd systemd-networkd-wait-online systemd-resolved

VOLUME ["/sys/fs/cgroup"]

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
