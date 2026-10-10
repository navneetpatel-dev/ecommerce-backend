#!/usr/bin/env bash
# ECS deploy helpers for GitHub Actions. Requires: aws CLI v2, jq, and
# ECS_CLUSTER in the environment. Identical copy in ecommerce-web.
#
#   ecs-deploy.sh register <task-family> <image>
#       Copy the family's latest revision (env/secrets/sizing owned by Terraform),
#       swap every container's image, register it. Prints the new revision ARN.
#
#   ecs-deploy.sh run-task <task-def-arn> <subnets-csv> <security-group>
#       Run a one-off Fargate task, wait for it, print its logs, and exit with the
#       container's exit code (used for database migrations).
#
#   ecs-deploy.sh roll <service>=<task-def-arn> [<service>=<task-def-arn> ...]
#       Point services at new revisions, wait for them to settle, and fail if
#       the deployment circuit breaker rolled any of them back.

set -euo pipefail

: "${ECS_CLUSTER:?ECS_CLUSTER must be set}"

log() { echo "::group::$*" >&2; }
endlog() { echo "::endgroup::" >&2; }

register() {
  local family=$1 image=$2 file
  file=$(mktemp)
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json \
    | jq --arg image "$image" '
        .containerDefinitions |= map(.image = $image)
        | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
              .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)' >"$file"
  aws ecs register-task-definition --cli-input-json "file://$file" \
    --query taskDefinition.taskDefinitionArn --output text
  rm -f "$file"
}

run_task() {
  local task_def=$1 subnets=$2 security_group=$3 out task_arn task_id
  out=$(aws ecs run-task \
    --cluster "$ECS_CLUSTER" \
    --task-definition "$task_def" \
    --launch-type FARGATE \
    --started-by "github-${GITHUB_RUN_ID:-manual}" \
    --network-configuration "awsvpcConfiguration={subnets=[${subnets}],securityGroups=[${security_group}],assignPublicIp=DISABLED}" \
    --output json)

  task_arn=$(jq -r '.tasks[0].taskArn // empty' <<<"$out")
  if [[ -z "$task_arn" ]]; then
    echo "::error::run-task did not start a task: $(jq -c '.failures' <<<"$out")"
    return 1
  fi
  task_id=${task_arn##*/}
  echo "Started $task_arn" >&2

  # The built-in waiter gives up after 10 minutes; loop so long migrations fit.
  local status=""
  for _ in $(seq 1 120); do
    status=$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
      --query 'tasks[0].lastStatus' --output text)
    [[ "$status" == "STOPPED" ]] && break
    sleep 10
  done
  if [[ "$status" != "STOPPED" ]]; then
    echo "::error::Task $task_id still $status after 20 minutes"
    return 1
  fi

  local desc container log_group stream_prefix exit_code
  desc=$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" --output json)
  container=$(jq -r '.tasks[0].containers[0].name' <<<"$desc")
  exit_code=$(jq -r '.tasks[0].containers[0].exitCode // "none"' <<<"$desc")

  read -r log_group stream_prefix < <(
    aws ecs describe-task-definition --task-definition "$task_def" --output json \
      | jq -r '.taskDefinition.containerDefinitions[0].logConfiguration.options
               | "\(."awslogs-group") \(."awslogs-stream-prefix")"'
  )

  log "Logs: $container ($task_id)"
  aws logs get-log-events \
    --log-group-name "$log_group" \
    --log-stream-name "${stream_prefix}/${container}/${task_id}" \
    --start-from-head --query 'events[].message' --output text 2>/dev/null \
    | tr '\t' '\n' || echo "(no logs available)"
  endlog

  if [[ "$exit_code" != "0" ]]; then
    echo "::error::$container exited with ${exit_code}: $(jq -r '.tasks[0].stoppedReason' <<<"$desc")"
    return 1
  fi
  echo "$container finished successfully" >&2
}

roll() {
  local services=() pair service arn
  declare -A wanted=()
  for pair in "$@"; do
    service=${pair%%=*}
    arn=${pair#*=}
    wanted[$service]=$arn
    services+=("$service")
    aws ecs update-service --cluster "$ECS_CLUSTER" --service "$service" \
      --task-definition "$arn" --query 'service.serviceName' --output text >/dev/null
    echo "Updating $service → ${arn##*/}" >&2
  done

  # services-stable also returns once a circuit-breaker rollback settles, so
  # check afterwards which revision actually won.
  aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "${services[@]}" || true

  local failed=0 current rollout
  for service in "${services[@]}"; do
    read -r current rollout < <(
      aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$service" --output json \
        | jq -r '.services[0].deployments[] | select(.status == "PRIMARY")
                 | "\(.taskDefinition) \(.rolloutState // "UNKNOWN")"'
    )
    if [[ "$current" != "${wanted[$service]}" || "$rollout" != "COMPLETED" ]]; then
      echo "::error::$service did not settle on ${wanted[$service]##*/} (primary: ${current##*/}, rollout: $rollout)"
      aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$service" \
        --query 'services[0].events[:8].[createdAt,message]' --output text >&2 || true
      failed=1
    else
      echo "$service is running ${current##*/}" >&2
    fi
  done
  return "$failed"
}

cmd=${1:-}
shift || true
case "$cmd" in
  register) register "$@" ;;
  run-task) run_task "$@" ;;
  roll) roll "$@" ;;
  *)
    echo "usage: $0 {register|run-task|roll} ..." >&2
    exit 2
    ;;
esac
