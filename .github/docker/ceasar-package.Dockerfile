FROM ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254

ARG NODEJS_DEB_VERSION=22.23.2-1nodesource1
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

RUN apt-get update -qq \
	&& apt-get install -y -qq --no-install-recommends \
		ca-certificates \
		curl \
		gnupg \
	&& install -d -m 0755 /etc/apt/keyrings \
	&& curl --fail --silent --show-error --location \
		https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
		| gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
	&& echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
		> /etc/apt/sources.list.d/nodesource.list \
	&& apt-get update -qq \
	&& apt-get install -y -qq --no-install-recommends \
		build-essential \
		composer \
		dpkg-dev \
		git \
		libcurl4-gnutls-dev \
		libgmp-dev \
		libonig-dev \
		libsqlite3-dev \
		libssl-dev \
		libxml2-dev \
		libz-dev \
		libzip-dev \
		lsb-release \
		"nodejs=${NODEJS_DEB_VERSION}" \
		openssl \
		php-cli \
		php-xml \
		php-zip \
		pkg-config \
		tar \
		unzip \
		wget \
		xz-utils \
	&& node_version="$(node --version)" \
	&& test "${node_version%%.*}" = 'v22' \
	&& rm -rf /var/lib/apt/lists/*
