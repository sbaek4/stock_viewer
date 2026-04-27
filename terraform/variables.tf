variable "project_name" {
  type        = string
  description = "Project name prefix for AWS resources"
  default     = "stock-viewer"
}

variable "aws_region" {
  type        = string
  description = "AWS region for deployment"
  default     = "us-east-1"
}

variable "container_cpu" {
  type        = number
  default     = 512
  description = "ECS task CPU units"
}

variable "container_memory" {
  type        = number
  default     = 1024
  description = "ECS task memory in MiB"
}
