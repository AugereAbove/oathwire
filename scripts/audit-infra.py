"""Offline SAM expansion and resource inventory. No AWS client or credentials are used."""
import copy
import json
import os
import tomllib
from pathlib import Path
import yaml
import cfnlint.api
from samtranslator.translator.transform import transform

os.environ['AWS_DEFAULT_REGION'] = 'eu-central-1'
os.environ['AWS_EC2_METADATA_DISABLED'] = 'true'

class Loader(yaml.SafeLoader):
    pass

def tag(loader, suffix, node):
    key = suffix if suffix == 'Ref' else 'Fn::' + suffix
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
        if suffix == 'GetAtt':
            value = value.split('.', 1)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node)
    else:
        value = loader.construct_mapping(node)
    return {key: value}

Loader.add_multi_constructor('!', tag)

class OfflinePolicies:
    def load(self):
        return {name: 'arn:aws:iam::aws:policy/service-role/' + name for name in (
            'AWSLambdaBasicExecutionRole', 'AWSLambdaSQSQueueExecutionRole')}

template = yaml.load(Path('infra/template.yaml').read_text(encoding='utf-8'), Loader=Loader)
resources = template['Resources']
for key in ('Api', 'Worker'):
    properties = resources[key]['Properties']
    assert properties['ReservedConcurrentExecutions'] == {'Fn::If': ['UseReservedConcurrency', 3, {'Ref': 'AWS::NoValue'}]}
    assert 'LoggingConfig' in properties
assert template['Globals']['Function']['Timeout'] == 20
assert template['Globals']['Function']['MemorySize'] == 256
for key in ('Data', 'Secrets'):
    properties = resources[key]['Properties']
    assert properties['BillingMode'] == 'PAY_PER_REQUEST'
    assert 'OnDemandThroughput' in properties
    assert properties['SSESpecification']['SSEEnabled'] is False
for index in resources['Data']['Properties']['GlobalSecondaryIndexes']:
    assert 'OnDemandThroughput' in index
assert resources['Queue']['Properties']['VisibilityTimeout'] >= 6 * template['Globals']['Function']['Timeout']
queue_policy = resources['QueueTlsPolicy']['Properties']
assert queue_policy['Queues'] == [{'Ref': 'Queue'}, {'Ref': 'DeadLetterQueue'}]
for statement in queue_policy['PolicyDocument']['Statement']:
    policy_resource = statement['Resource']
    assert not isinstance(policy_resource, list) or len(policy_resource) == 1, 'SQS requires one resource per statement'
    assert statement['Effect'] == 'Deny'
    assert statement['Action'] == 'sqs:*'
    assert statement['Principal'] == '*'
    assert statement['Condition'] == {'Bool': {'aws:SecureTransport': False}}
assert resources['Worker']['Properties']['Events']['Jobs']['Properties']['ScalingConfig']['MaximumConcurrency'] == 2
assert resources['UserPool']['Properties']['AdminCreateUserConfig']['AllowAdminCreateUserOnly'] is True
assert resources['UserPool']['Properties']['UserPoolTier'] == 'LITE'
assert resources['HttpApi']['Properties']['Auth']['DefaultAuthorizer'] == 'Cognito'
for key in ('ApiLogs', 'WorkerLogs'):
    assert resources[key]['Properties']['RetentionInDays'] == 7
for key in ('ApiRole', 'WorkerRole'):
    assert resources[key]['Properties']['PermissionsBoundary'] == {'Ref': 'RuntimePermissionsBoundaryArn'}
    assert 'ManagedPolicyArns' not in resources[key]['Properties']
    for policy in resources[key]['Properties']['Policies']:
        for statement in policy['PolicyDocument']['Statement']:
            assert statement['Resource'] != '*'
            assert statement['Action'] != '*'
assert not any(r['Type'].startswith(('AWS::EC2::', 'AWS::RDS::', 'AWS::EKS::', 'AWS::ElasticLoadBalancing')) for r in resources.values())
settings = tomllib.loads(Path('samconfig.toml').read_text(encoding='utf-8'))
assert settings['default']['global']['parameters']['region'] == 'eu-central-1'
assert settings['default']['deploy']['parameters']['confirm_changeset'] is True
assert settings['default']['deploy']['parameters']['no_execute_changeset'] is True
workflow = yaml.safe_load(Path('.github/workflows/deploy.yml').read_text(encoding='utf-8'))
commands = '\n'.join(step.get('run', '') for step in workflow['jobs']['plan']['steps'])
assert '--no-execute-changeset' in commands
assert 'aws cloudformation execute-change-set' not in commands
assert 'aws s3 ' not in commands
parameters = {key: value['Default'] for key, value in template['Parameters'].items() if 'Default' in value}
parameters.update(AuthDomainPrefix='oathwire-audit-placeholder', BudgetEmail='owner@example.com')
parameters['RuntimePermissionsBoundaryArn'] = 'arn:aws:iam::000000000000:policy/oathwire-audit-placeholder'
for resource in template['Resources'].values():
    if resource['Type'] == 'AWS::Serverless::Function':
        resource['Properties']['CodeUri'] = 's3://oathwire-offline-placeholder/bundle.zip'
assert template['Parameters']['ConcurrencyMode']['Default'] == 'reserved'
assert template['Parameters']['ConcurrencyMode']['AllowedValues'] == ['reserved', 'shared-beta']
assert template['Conditions']['UseReservedConcurrency'] == {'Fn::Equals': [{'Ref': 'ConcurrencyMode'}, 'reserved']}
for mode in ('reserved', 'shared-beta'):
    selected = copy.deepcopy(template)
    for key in ('Api', 'Worker'):
        props = selected['Resources'][key]['Properties']
        if mode == 'reserved':
            props['ReservedConcurrentExecutions'] = 3
        else:
            props.pop('ReservedConcurrentExecutions')
    expanded_mode = transform(selected, dict(parameters, ConcurrencyMode=mode), OfflinePolicies())
    for key in ('Api', 'Worker'):
        props = expanded_mode['Resources'][key]['Properties']
        assert (props.get('ReservedConcurrentExecutions') == 3) if mode == 'reserved' else ('ReservedConcurrentExecutions' not in props)
        assert expanded_mode['Resources'][key + 'Role']['Properties']['PermissionsBoundary'] == {'Ref': 'RuntimePermissionsBoundaryArn'}
    assert expanded_mode['Resources']['WorkerJobs']['Properties']['ScalingConfig']['MaximumConcurrency'] == 2
    assert expanded_mode['Resources']['HttpApiApiGatewayDefaultStage']['Properties']['DefaultRouteSettings'] == {'ThrottlingBurstLimit': 20, 'ThrottlingRateLimit': 10}
    assert len(expanded_mode['Resources']) == 35
    if mode == 'reserved':
        expanded = expanded_mode
bootstrap = yaml.load(Path('infra/bootstrap.yaml').read_text(encoding='utf-8'), Loader=Loader)
assert len(bootstrap['Resources']) == 4
statements = bootstrap['Resources']['ExecutionRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
api_collection = {'Fn::Sub': 'arn:${AWS::Partition}:apigateway:${AWS::Region}::/apis'}
assert any(statement['Resource'] == api_collection and 'apigateway:PUT' in (
    statement['Action'] if isinstance(statement['Action'], list) else [statement['Action']]
) for statement in statements), 'CloudFormation imports the HTTP API with PUT /apis'
mapping_reads = [statement for statement in statements if statement['Resource'] == '*' and statement['Action'] == 'lambda:GetEventSourceMapping']
assert len(mapping_reads) == 1
assert mapping_reads[0]['Condition'] == {'StringEquals': {'aws:RequestedRegion': {'Ref': 'AWS::Region'}}}
stage_creates = [statement for statement in statements if statement.get('Sid') == 'CreateTaggedHttpApiStage']
assert len(stage_creates) == 1
assert stage_creates[0]['Action'] == ['apigateway:POST', 'apigateway:TagResource']
assert stage_creates[0]['Resource'] == {'Fn::Sub': 'arn:${AWS::Partition}:apigateway:${AWS::Region}::/apis/*/stages'}
assert stage_creates[0]['Condition'] == {'StringEquals': {
    'aws:RequestedRegion': {'Ref': 'AWS::Region'},
    'aws:RequestTag/OathwireStack': {'Ref': 'ApplicationStackName'},
}}
assert bootstrap['Resources']['ExecutionRole']['Metadata'] == {'cfn-lint': {'config': {'ignore_checks': ['W3037']}}}
schema_directory = Path(cfnlint.__file__).parent / 'data' / 'schemas'
provider_index = json.loads((schema_directory / 'providers' / 'eu-central-1.json').read_text())
stage_schema = json.loads((schema_directory / 'resources' / (provider_index['AWS::ApiGatewayV2::Stage'] + '.json')).read_text())
assert 'apigateway:TagResource' in stage_schema['handlers']['create']['permissions']
unsuppressed = copy.deepcopy(bootstrap)
unsuppressed['Resources']['ExecutionRole'].pop('Metadata')
stage_index = statements.index(stage_creates[0])
expected_path = ['Resources', 'ExecutionRole', 'Properties', 'Policies', 0, 'PolicyDocument', 'Statement', stage_index, 'Action']
def expected_tagging_warning(selected):
    findings = cfnlint.api.lint(json.dumps(selected), regions=['eu-central-1'])
    return len(findings) == 1 and findings[0].rule.id == 'W3037' and findings[0].path == expected_path and findings[0].message.startswith("'tagresource' is not one of")
assert expected_tagging_warning(unsuppressed), 'Only the provider-declared TagResource catalog conflict is allowed'
invalid = copy.deepcopy(unsuppressed)
invalid['Resources']['ExecutionRole']['Properties']['Policies'][0]['PolicyDocument']['Statement'][0]['Action'].append('iam:OathwireInvalidAction')
assert not expected_tagging_warning(invalid), 'An unrelated invalid action must still fail'
for statement in statements:
    actions = statement['Action'] if isinstance(statement['Action'], list) else [statement['Action']]
    assert '*' not in actions
    if 'iam:CreateRole' in actions:
        assert statement['Condition']['StringEquals']['iam:PermissionsBoundary'] == {'Ref': 'RuntimeBoundary'}
    if any(a.startswith('iam:') for a in actions):
        assert len(statement['Resource']) == 2
        assert all(r['Fn::Sub'].endswith(('-api-runtime', '-worker-runtime')) for r in statement['Resource'])
    if 'cloudfront:TagResource' in actions or 'cognito-idp:TagResource' in actions:
        assert 'aws:RequestTag/OathwireStack' in statement['Condition']['StringEquals']
        assert 'aws:ResourceTag/OathwireStack' in statement['Condition']['StringEqualsIfExists']
    if 'lambda:UpdateEventSourceMapping' in actions:
        assert 'lambda:FunctionArn' in statement['Condition']['ArnLike']
for file in Path('infra/policies').glob('*.json'):
    policy = json.loads(file.read_text(encoding='utf-8'))
    assert '${' not in json.dumps(policy).replace('${AccountId}', '')
    for statement in policy['Statement']:
        actions = statement['Action'] if isinstance(statement['Action'], list) else [statement['Action']]
        assert not any('*' in action for action in actions)
        assert not any(action.startswith(('iam:CreateAccessKey', 'iam:CreateUser', 'iam:AttachUserPolicy')) for action in actions)
        if 'iam:PassRole' in actions:
            assert statement['Resource'].endswith(':role/oathwire-beta-cloudformation')
            assert statement['Condition']['StringEquals']['iam:PassedToService'] == 'cloudformation.amazonaws.com'
planner = json.loads(Path('infra/policies/application-planner.json').read_text(encoding='utf-8'))
assert 'cloudformation:ExecuteChangeSet' not in json.dumps(planner)
assert 'cloudformation:DeleteStack' not in json.dumps(planner)
assert 's3:DeleteObject' not in json.dumps(planner)
request = json.loads(Path('infra/quota-increase-request.json').read_text(encoding='utf-8'))
assert request == {'ServiceCode': 'lambda', 'QuotaCode': 'L-B99A9384', 'DesiredValue': 1000, 'SupportCaseAllowed': True}

out = Path('.local/audit')
out.mkdir(parents=True, exist_ok=True)
(out / 'expanded-template.json').write_text(json.dumps(expanded, indent=2), encoding='utf-8')
resources = expanded['Resources']
rows = [{'id': key, 'type': value['Type']} for key, value in sorted(resources.items())]
(out / 'resource-inventory.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
print(json.dumps({'offlineAssertions': 'passed', 'resourceCount': len(rows), 'resources': rows}, indent=2))
