#!/usr/bin/env bats

if [ "${PATH#*/usr/local/ceasar/bin*}" = "$PATH" ]; then
    . /etc/profile.d/ceasar.sh
fi

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'
load 'test_helper/bats-file/load'

function random() {
head /dev/urandom | tr -dc 0-9 | head -c$1
}

function setup() {
    # echo "# Setup_file" > &3
    if [ $BATS_TEST_NUMBER = 1 ]; then
        echo 'user=test-5285' > /tmp/ceasar-test-env.sh
        echo 'user2=test-5286' >> /tmp/ceasar-test-env.sh
        echo 'userbk=testbk-5285' >> /tmp/ceasar-test-env.sh
        echo 'userpass1=test-5285' >> /tmp/ceasar-test-env.sh
        echo 'userpass2=t3st-p4ssw0rd' >> /tmp/ceasar-test-env.sh
        echo 'CEASAR=/usr/local/ceasar' >> /tmp/ceasar-test-env.sh
        echo 'domain=test-5285.ceasar.com' >> /tmp/ceasar-test-env.sh
        echo 'domainuk=test-5285.ceasar.com.uk' >> /tmp/ceasar-test-env.sh
        echo 'rootdomain=testceasar.com' >> /tmp/ceasar-test-env.sh
        echo 'subdomain=cdn.testceasar.com' >> /tmp/ceasar-test-env.sh
        echo 'database=test-5285_database' >> /tmp/ceasar-test-env.sh
        echo 'dbuser=test-5285_dbuser' >> /tmp/ceasar-test-env.sh
    fi

    source /tmp/ceasar-test-env.sh
    source $CEASAR/func/main.sh
    source $CEASAR/conf/ceasar.conf
    source $CEASAR/func/ip.sh
}



function validate_web_domain() {
    local user=$1
    local domain=$2
    local webproof=$3
    local webpath=${4}
    local valwebpath=${5}

    refute [ -z "$user" ]
    refute [ -z "$domain" ]
    refute [ -z "$webproof" ]

    source $CEASAR/func/ip.sh

    run v-list-web-domain $user $domain
    assert_success

    USER_DATA=$CEASAR/data/users/$user
    local domain_ip=$(get_object_value 'web' 'DOMAIN' "$domain" '$IP')
    SSL=$(get_object_value 'web' 'DOMAIN' "$domain" '$SSL')
    domain_ip=$(get_real_ip "$domain_ip")

    if [ -z $valwebpath ]; then
        if [ ! -z $webpath ]; then
            domain_docroot=$(get_object_value 'web' 'DOMAIN' "$domain" '$CUSTOM_DOCROOT')
            if [ -n "$domain_docroot" ] && [ -d "$domain_docroot" ]; then
                assert_file_exist "${domain_docroot}/${webpath}"
            else
                assert_file_exist "${HOMEDIR}/${user}/web/${domain}/public_html/${webpath}"
            fi
        fi
    fi
    # Test HTTP
    run curl --location --silent --show-error --insecure --resolve "${domain}:80:${domain_ip}" "http://${domain}/${webpath}"
    assert_success
    assert_output --partial "$webproof"

    # Test HTTPS
    if [ "$SSL" = "yes" ]; then
        run v-list-web-domain-ssl $user $domain
        assert_success

        run curl --location --silent --show-error --insecure --resolve "${domain}:443:${domain_ip}" "https://${domain}/${webpath}"
        assert_success
        assert_output --partial "$webproof"
    fi
}

#----------------------------------------------------------#
#                     Backup / Restore                     #
#----------------------------------------------------------#

#Test backup
#  Ceasar v1.1.1 archive contains:
#    user: ceasar111
#    web:
#      - test.ceasar.com (+SSL self-signed)
#    dns:
#      - test.ceasar.com
#    mail:
#      - test.ceasar.com
#    mail acc:
#      - testaccount@test.ceasar.com
#    db:
#      - ceasar111_db
#    cron:
#      - 1: /bin/true
#  Ceasar 1.7.0 archive contains (As zstd format)
#    user: ceasar131
#    web:
#      - test.ceasar.com (+SSL self-signed)
#        FTP Account
#        Awstats enabled
#    dns:
#      - test.ceasar.com
#    mail:
#      - test.ceasar.com
#        Ratelimit: 10
#    mail acc:
#      - testaccount@test.ceasar.com
#           Alias: info@test.ceasar.com
#           Ratelimit: 20
#      - support@test.ceasar.com
#    db:
#      - ceasar170_db
#    cron:
#      - 1: /bin/true
#  Vesta 0.9.8-23 archive contains:
#    user: vesta09823
#    web:
#      - vesta09823.tld (+SSL self-signed)
#    dns:
#      - vesta09823.tld
#    mail:
#      - vesta09823.tld
#    mail acc:
#      - testaccount@vesta09823.tld
#    db:
#      - vesta09823_db
#    cron:
#      - 1: /bin/true
#

@test "Check if test.ceasar.com is present" {
	assert_file_contains /etc/hosts test.ceasar.com
}

# Testing Ceasar backups
@test "Restore[1]: Ceasar archive for a non-existing user" {
    if [ -d "$HOMEDIR/$userbk" ]; then
        run v-delete-user $userbk
        assert_success
        refute_output
    fi

    mkdir -p /backup

    local archive_name="ceasar111.2020-03-26"
    run wget --quiet --tries=3 --timeout=15 --read-timeout=15 --waitretry=3 --no-dns-cache "https://storage.ceasar.com/testing/data/${archive_name}.tar" -O "/backup/${archive_name}.tar"
    assert_success

    run v-restore-user $userbk "${archive_name}.tar"
    assert_success

    rm "/backup/${archive_name}.tar"
}

@test "Restore[1]: From Ceasar [WEB]" {
    local domain="test.ceasar.com"
    validate_web_domain $userbk $domain 'Hello Ceasar'
}

@test "Restore[1]: From Ceasar [DNS]" {
    local domain="test.ceasar.com"

    run v-list-dns-domain $userbk $domain
    assert_success

    run nslookup $domain 127.0.0.1
    assert_success
}

@test "Restore[1]: From Ceasar [MAIL]" {
    local domain="test.ceasar.com"

    run v-list-mail-domain $userbk $domain
    assert_success
}

@test "Restore[1]: From Ceasar [MAIL-Account]" {
    local domain="test.ceasar.com"

    run v-list-mail-account $userbk $domain testaccount
    assert_success
}

@test "Restore[1]: From Ceasar [DB]" {
    run v-list-database $userbk "${userbk}_db"
    assert_success
}

@test "Restore[1]: From Ceasar [CRON]" {
    run v-list-cron-job $userbk 1
    assert_success
}

@test "Restore[1]: From Ceasar Cleanup" {
    run v-delete-user $userbk
    assert_success
    refute_output
}


@test "Restore[2]: Ceasar archive over a existing user" {
    if [ -d "$HOMEDIR/$userbk" ]; then
        run v-delete-user $userbk
        assert_success
        refute_output
    fi

    if [ ! -d "$HOMEDIR/$userbk" ]; then
        run v-add-user $userbk $userbk test@ceasar.com
        assert_success
    fi

    mkdir -p /backup

    local archive_name="ceasar111.2020-03-26"
    run wget --quiet --tries=3 --timeout=15 --read-timeout=15 --waitretry=3 --no-dns-cache "https://storage.ceasar.com/testing/data/${archive_name}.tar" -O "/backup/${archive_name}.tar"
    assert_success

    run v-restore-user $userbk "${archive_name}.tar"
    assert_success

    rm "/backup/${archive_name}.tar"
}

@test "Restore[2]: From Ceasar [WEB]" {
    local domain="test.ceasar.com"
    validate_web_domain $userbk "${domain}" 'Hello Ceasar'
}

@test "Restore[2]: From Ceasar [DNS]" {
    local domain="test.ceasar.com"

    run v-list-dns-domain $userbk $domain
    assert_success

    run nslookup $domain 127.0.0.1
    assert_success
}

@test "Restore[2]: From Ceasar [MAIL]" {
    local domain="test.ceasar.com"

    run v-list-mail-domain $userbk $domain
    assert_success
}

@test "Restore[2]: From Ceasar [MAIL-Account]" {
    local domain="test.ceasar.com"

    run v-list-mail-account $userbk $domain testaccount
    assert_success
}

@test "Restore[2]: From Ceasar [DB]" {
    run v-list-database $userbk "${userbk}_db"
    assert_success
}

@test "Restore[2]: From Ceasar [CRON]" {
    run v-list-cron-job $userbk 1
    assert_success
}

@test "Restore[2]: From Ceasar Cleanup" {
    run v-delete-user $userbk
    assert_success
    refute_output
}

@test "Restore[3]: Ceasar (zstd) archive for a non-existing user" {
    if [ -d "$HOMEDIR/$userbk" ]; then
        run v-delete-user $userbk
        assert_success
        refute_output
    fi

    mkdir -p /backup

    local archive_name="ceasar170.2022-08-23"
    run wget --quiet --tries=3 --timeout=15 --read-timeout=15 --waitretry=3 --no-dns-cache "https://storage.ceasar.com/testing/data/${archive_name}.tar" -O "/backup/${archive_name}.tar"
    assert_success

    run v-restore-user $userbk "${archive_name}.tar"
    assert_success

    rm "/backup/${archive_name}.tar"
}

@test "Restore[3]: From Ceasar [WEB]" {
    local domain="test.ceasar.com"
    validate_web_domain $userbk $domain 'Hello Ceasar'
}

@test "Restore[3]: From Ceasar [WEB] FTP" {
    local domain="test.ceasar.com"
    assert_file_contains /etc/passwd "$userbk_test"
    assert_file_contains /etc/passwd "/home/$userbk/web/$domain"
}

@test "Restore[3]: From Ceasar [WEB] Awstats" {
    local domain="test.ceasar.com"
    assert_file_exist /home/$userbk/conf/web/$domain/awstats.conf
}

@test "Restore[3]: From Ceasar [WEB] Custom rule" {
    # check if custom rule is still working
    local domain="test.ceasar.com"
    validate_web_domain $userbk $domain 'ceasar-yes' '/ceasar/ceasar' 'no'
}


@test "Restore[3]: From Ceasar [DNS]" {
    local domain="test.ceasar.com"

    run v-list-dns-domain $userbk $domain
    assert_success

    run nslookup $domain 127.0.0.1
    assert_success
}

@test "Restore[3]: From Ceasar [MAIL]" {
    local domain="test.ceasar.com"

    run v-list-mail-domain $userbk $domain
    assert_success
}

@test "Restore[3]: From Ceasar [MAIL-Account]" {
    local domain="test.ceasar.com"

    run v-list-mail-account $userbk $domain testaccount
    assert_success
    # Check if alias is created
    assert_file_contains /etc/exim4/domains/$domain/aliases "testaccount@$domain"
    # Check if expected rate limits are set
    assert_file_contains /etc/exim4/domains/$domain/limits "testaccount@$domain:20"
    assert_file_contains /etc/exim4/domains/$domain/limits "support@$domain:10"
}

@test "Restore[3]: From Ceasar [DB]" {
    run v-list-database $userbk "${userbk}_db"
    assert_success
}

@test "Restore[3]: From Ceasar [CRON]" {
    run v-list-cron-job $userbk 1
    assert_success
}


@test "Restore[3]: From Ceasar Cleanup" {
    run v-delete-user $userbk
    assert_success
    refute_output
}

@test "Restore[4]: Ceasar (zstd) archive for a existing user" {
    if [ -d "$HOMEDIR/$userbk" ]; then
        run v-delete-user $userbk
        assert_success
        refute_output
    fi

    if [ ! -d "$HOMEDIR/$userbk" ]; then
        run v-add-user $userbk $userbk test@ceasar.com
        assert_success
    fi

    mkdir -p /backup

    local archive_name="ceasar170.2022-08-23"
    run wget --quiet --tries=3 --timeout=15 --read-timeout=15 --waitretry=3 --no-dns-cache "https://storage.ceasar.com/testing/data/${archive_name}.tar" -O "/backup/${archive_name}.tar"
    assert_success

    run v-restore-user $userbk "${archive_name}.tar"
    assert_success

    rm "/backup/${archive_name}.tar"
}

@test "Restore[4]: From Ceasar [WEB]" {
    local domain="test.ceasar.com"
    validate_web_domain $userbk $domain 'Hello Ceasar'
}

@test "Restore[4]: From Ceasar [WEB] FTP" {
    local domain="test.ceasar.com"
    assert_file_contains /etc/passwd "$userbk_test"
    assert_file_contains /etc/passwd "/home/$userbk/web/$domain"
}

@test "Restore[4]: From Ceasar [WEB] Awstats" {
    local domain="test.ceasar.com"
    assert_file_exist /home/$userbk/conf/web/$domain/awstats.conf
}

@test "Restore[4]: From Ceasar [WEB] Custom rule" {
    # check if custom rule is still working
    local domain="test.ceasar.com"
    validate_web_domain $userbk $domain 'ceasar-yes' '/ceasar/ceasar' 'no'
}


@test "Restore[4]: From Ceasar [DNS]" {
    local domain="test.ceasar.com"

    run v-list-dns-domain $userbk $domain
    assert_success

    run nslookup $domain 127.0.0.1
    assert_success
}

@test "Restore[4]: From Ceasar [MAIL]" {
    local domain="test.ceasar.com"

    run v-list-mail-domain $userbk $domain
    assert_success
}

@test "Restore[4]: From Ceasar [MAIL-Account]" {
    local domain="test.ceasar.com"

    run v-list-mail-account $userbk $domain testaccount
    assert_success
    # Check if alias is created
    assert_file_contains /etc/exim4/domains/$domain/aliases "testaccount@$domain"
    # Check if expected rate limits are set
    assert_file_contains /etc/exim4/domains/$domain/limits "testaccount@$domain:20"
    assert_file_contains /etc/exim4/domains/$domain/limits "support@$domain:10"
}

@test "Restore[4]: From Ceasar [DB]" {
    run v-list-database $userbk "${userbk}_db"
    assert_success
}

@test "Restore[4]: From Ceasar [CRON]" {
    run v-list-cron-job $userbk 1
    assert_success
}

@test "Restore[4]: From Ceasar Cleanup" {
    run v-delete-user $userbk
    assert_success
    refute_output
}


# Testing Vesta Backups
@test "Restore[1]: Vesta archive for a non-existing user" {
    if [ -d "$HOMEDIR/$userbk" ]; then
        run v-delete-user $userbk
        assert_success
        refute_output
    fi

    mkdir -p /backup

    local archive_name="vesta09823.2018-10-18"
    run wget --quiet --tries=3 --timeout=15 --read-timeout=15 --waitretry=3 --no-dns-cache "https://storage.ceasar.com/testing/data/${archive_name}.tar" -O "/backup/${archive_name}.tar"
    assert_success

    run v-restore-user $userbk "${archive_name}.tar"
    assert_success

    rm "/backup/${archive_name}.tar"
}

@test "Restore[1]: From Vesta [WEB]" {
    local domain="vesta09823.tld"
    validate_web_domain $userbk $domain 'Hello Vesta'
}

@test "Restore[1]: From Vesta [DNS]" {
    local domain="vesta09823.tld"

    run v-list-dns-domain $userbk $domain
    assert_success

    run nslookup $domain 127.0.0.1
    assert_success
}

@test "Restore[1]: From Vesta [MAIL]" {
    local domain="vesta09823.tld"

    run v-list-mail-domain $userbk $domain
    assert_success
}

@test "Restore[1]: From Vesta [MAIL-Account]" {
    local domain="vesta09823.tld"

    run v-list-mail-account $userbk $domain testaccount
    assert_success
}

@test "Restore[1]: From Vesta [DB]" {
    run v-list-database $userbk "${userbk}_db"
    assert_success
}

@test "Restore[1]: From Vesta [CRON]" {
    run v-list-cron-job $userbk 1
    assert_success
}

@test "Restore[1]: From Vesta Cleanup" {
    run v-delete-user $userbk
    assert_success
    refute_output
}


@test "Restore[2]: Vesta archive over a existing user" {
    if [ -d "$HOMEDIR/$userbk" ]; then
        run v-delete-user $userbk
        assert_success
        refute_output
    fi

    if [ ! -d "$HOMEDIR/$userbk" ]; then
        run v-add-user $userbk $userbk test@ceasar.com
        assert_success
    fi

    mkdir -p /backup

    local archive_name="vesta09823.2018-10-18"
    run wget --quiet --tries=3 --timeout=15 --read-timeout=15 --waitretry=3 --no-dns-cache "https://storage.ceasar.com/testing/data/${archive_name}.tar" -O "/backup/${archive_name}.tar"
    assert_success

    run v-restore-user $userbk "${archive_name}.tar"
    assert_success

    rm "/backup/${archive_name}.tar"
}

@test "Restore[2]: From Vesta [WEB]" {
    local domain="vesta09823.tld"
    validate_web_domain $userbk "${domain}" 'Hello Vesta'
}

@test "Restore[2]: From Vesta [DNS]" {
    local domain="vesta09823.tld"

    run v-list-dns-domain $userbk $domain
    assert_success

    run nslookup $domain 127.0.0.1
    assert_success
}

@test "Restore[2]: From Vesta [MAIL]" {
    local domain="vesta09823.tld"

    run v-list-mail-domain $userbk $domain
    assert_success
}

@test "Restore[2]: From Vesta [MAIL-Account]" {
    local domain="vesta09823.tld"

    run v-list-mail-account $userbk $domain testaccount
    assert_success
}

@test "Restore[2]: From Vesta [DB]" {
    run v-list-database $userbk "${userbk}_db"
    assert_success
}

@test "Restore[2]: From Vesta [CRON]" {
    run v-list-cron-job $userbk 1
    assert_success
}

@test "Restore[2]: From Vesta Cleanup" {
    run v-delete-user $userbk
    assert_success
    refute_output
}
