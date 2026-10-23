"""Offline SAM expansion and resource inventory. No AWS client or credentials are used."""
import json
import os
import tomllib
from pathlib import Path
import yaml
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
    assert properties['ReservedConcurrentExecutions'] == 3
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
assert resources['Worker']['Properties']['Events']['Jobs']['Properties']['ScalingConfig']['MaximumConcurrency'] == 2
assert resources['UserPool']['Properties']['AdminCreateUserConfig']['AllowAdminCreateUserOnly'] is True
assert resources['UserPool']['Properties']['UserPoolTier'] == 'LITE'
assert resources['HttpApi']['Properties']['Auth']['DefaultAuthorizer'] == 'Cognito'
for key in ('ApiLogs', 'WorkerLogs'):
    assert resources[key]['Properties']['RetentionInDays'] == 7
for key in ('ApiRole', 'WorkerRole'):
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
for resource in template['Resources'].values():
    if resource['Type'] == 'AWS::Serverless::Function':
        resource['Properties']['CodeUri'] = 's3://oathwire-offline-placeholder/bundle.zip'
expanded = transform(template, parameters, OfflinePolicies())
out = Path('.local/audit')
out.mkdir(parents=True, exist_ok=True)
(out / 'expanded-template.json').write_text(json.dumps(expanded, indent=2), encoding='utf-8')
resources = expanded['Resources']
rows = [{'id': key, 'type': value['Type']} for key, value in sorted(resources.items())]
(out / 'resource-inventory.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
print(json.dumps({'offlineAssertions': 'passed', 'resourceCount': len(rows), 'resources': rows}, indent=2))
