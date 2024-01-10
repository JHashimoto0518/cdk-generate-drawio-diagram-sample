import { Stack, StackProps, CfnOutput, Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_tg from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets'
import { Construct } from 'constructs';

export class CdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // vpc
    const vpc = new ec2.Vpc(this, 'WebVpc', {
      vpcName: 'web-vpc',
      ipAddresses: ec2.IpAddresses.cidr('172.16.0.0/16'),
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED
        }
      ],
      // remove all rules from default security group
      // See: https://docs.aws.amazon.com/config/latest/developerguide/vpc-default-security-group-closed.html
      restrictDefaultSecurityGroup: true
    });

    //
    // security groups
    //
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      allowAllOutbound: true,
      description: 'security group for alb'
    })
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'allow http traffic from anyone')

    const ec2Sg = new ec2.SecurityGroup(this, 'WebEc2Sg', {
      vpc,
      allowAllOutbound: true,
      description: 'security group for a web server'
    })
    ec2Sg.connections.allowFrom(albSg, ec2.Port.tcp(80), 'allow http traffic from alb')

    const ec2Instance = new ec2.Instance(this, 'WebEc2', {
      instanceName: 'web-ec2',
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      vpc,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }),
      securityGroup: ec2Sg,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(8, {
            encrypted: true
          }),
        },
      ],
      ssmSessionPermissions: true,
      propagateTagsToVolumeOnCreation: true,
    })

    //
    // alb
    //
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      internetFacing: true,
      vpc,
      vpcSubnets: {
        subnets: vpc.publicSubnets
      },
      securityGroup: albSg
    })

    const listener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP
    })
    const targets = new Array();
    targets.push(
      new elbv2_tg.InstanceTarget(ec2Instance)
    )
    listener.addTargets('WebEc2Target', {
      targets,
      port: 80
    })

    new CfnOutput(this, 'TestCommand', {
      value: `curl http://${alb.loadBalancerDnsName}`
    })

    const albName = alb.loadBalancerName
    const ec2Name = ec2Instance.instanceId
    const ec2Refs = albName

    const drawioCsv: string = `
## Simple web server AWS diagram
# label: %component%
# style: shape=%shape%;fillColor=%fill%;strokeColor=%stroke%;verticalLabelPosition=bottom;
# namespace: csvimport-
# connect: {"from":"refs", "to":"component", "invert":true, "style":"curved=0;endArrow=block;endFill=0;dashed=1;strokeColor=#6c8ebf;"}
# width: 80
# height: 80
# ignore: refs
# nodespacing: 40
# levelspacing: 40
# edgespacing: 40
# layout: horizontaltree
## CSV data starts below this line
component,fill,stroke,shape,refs
${albName},#8C4FFF,#ffffff,mxgraph.aws4.application_load_balancer,
${ec2Name},#ED7100,#ffffff,mxgraph.aws4.ec2,${ec2Refs}
`
    new CfnOutput(this, 'DrawioCsv', {
      value: drawioCsv
    })
  }
}
