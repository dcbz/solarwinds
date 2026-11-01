#!/usr/bin/env perl
# gtimeout.pl — portable `timeout` replacement for this host (no coreutils).
#
#   gtimeout.pl <seconds> <command> [args...]
#
# Runs <command> in a child process, sends SIGTERM after <seconds>, escalates to
# SIGKILL 1 s later if it is still alive. Exits with the child's status, or 124
# if it had to be killed. This is the guard that keeps every harness invocation
# bounded, so a hung emulator can never stall the lane.

use strict;
use warnings;
use POSIX qw(:sys_wait_h);

my $secs = shift
    or die "usage: gtimeout.pl <seconds> <command> [args...]\n";
die "gtimeout.pl: no command given\n" unless @ARGV;

my @cmd = @ARGV;
$secs =~ /^\d+$/ or die "gtimeout.pl: seconds must be a non-negative integer\n";

$SIG{PIPE} = 'IGNORE';

my $pid = fork();
die "gtimeout.pl: fork failed: $!\n" unless defined $pid;

if ($pid == 0) {
    { no warnings 'exec'; exec @cmd; }
    print STDERR "gtimeout.pl: exec failed: $!\n";
    POSIX::_exit(127);
}

my $killed = 0;
$SIG{ALRM} = sub {
    return if $killed > 1;
    if ($killed == 0) {
        $killed = 1;
        kill 'TERM', $pid;
        alarm 1;          # grace period, then escalate
    } else {
        $killed = 2;
        kill 'KILL', $pid;
    }
};

alarm $secs;

my $status = 0;
while (1) {
    my $done = waitpid($pid, 0);
    if ($done > 0) {
        $status = $?;
        last;
    }
    last if $done < 0;
}
alarm 0;

if ($killed) {
    kill 'KILL', $pid;
    waitpid($pid, 0);
    print STDERR "[gtimeout] ${secs}s limit reached; terminated child $pid\n";
    exit 124;
}
exit($status >> 8);
