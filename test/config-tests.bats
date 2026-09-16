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

@test "Setup Test domain" {
    run v-add-user $user $user $user@ceasar.com default "Super Test"
    assert_success
    refute_output

    run v-add-web-domain $user 'testceasar.com'
    assert_success
    refute_output

    ssl=$(v-generate-ssl-cert "testceasar.com" "info@testceasar.com" US CA "Orange County" Ceasar IT "mail.$domain" | tail -n1 | awk '{print $2}')
    mv $ssl/testceasar.com.crt /tmp/testceasar.com.crt
    mv $ssl/testceasar.com.key /tmp/testceasar.com.key

    # Use self signed certificates during last test
    run v-add-web-domain-ssl $user testceasar.com /tmp
    assert_success
    refute_output
}

@test "Web Config test" {
    for template in $(v-list-web-templates plain); do
        run v-change-web-domain-tpl $user testceasar.com $template
        assert_success
        refute_output
    done
}

@test "Proxy Config test" {
    if [ "$PROXY_SYSTEM" = "nginx" ]; then
        for template in $(v-list-proxy-templates plain); do
            run v-change-web-domain-proxy-tpl $user testceasar.com $template
            assert_success
            refute_output
        done
    else
        skip "Proxy not installed"
    fi
}

@test "Clean up" {
    run v-delete-user $user
    assert_success
    refute_output
}
